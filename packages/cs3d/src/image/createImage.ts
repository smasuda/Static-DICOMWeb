import { utilities } from "@cornerstonejs/core"
import { IImage } from "@cornerstonejs/core/types"
import { VOILUTFunctionType } from "@cornerstonejs/core/enums"
import dcmjs from "dcmjs"
import { imageFrameUtils } from "../util"

/**
 * Creates CornerstoneCore image object for already decodedPixel data.
 * It returns an complex object to be used by CS api methods layer.
 *
 * @param {*} transferSyntax
 * @param {*} decodedPixelData
 * @param {*} metadata
 * @param {*} canvas browser canvas (this param is mutate)
 * @param {*} options
 * @returns
 */
export function createImage(
  transferSyntax,
  decodedPixelData,
  metadata,
  canvas,
  options = { convertFloatPixelDataToInt: null, targetBuffer: null }
): IImage {
  const dataSet = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
    JSON.parse(JSON.stringify(metadata))
  )
  const imageFrame = imageFrameUtils.get.fromDataset(dataSet, decodedPixelData)

  const { convertFloatPixelDataToInt, targetBuffer } = options

  // If we have a target buffer that was written to in the
  // Decode task, point the image to it here.
  // We can't have done it within the thread incase it was a SharedArrayBuffer.
  const alreadyTyped = imageFrameUtils.convert.pixelDataToTargetBuffer(
    imageFrame,
    targetBuffer
  )
  const originalDataConstructor = imageFrame.pixelData.constructor

  // setup the canvas context
  canvas.height = imageFrame.rows
  canvas.width = imageFrame.columns

  const {
    ModalityLUTSequence: modalityLUTSequence,
    PixelSpacing: pixelSpacing,
    RescaleIntercept: intercept = 0,
    RescaleSlope: slope = 1,
    VOILUTSequence: voiLUTSequence,
    WindowCenter: windowCenter,
    WindowWidth: windowWidth,
    SOPClassUID: sopClassUID,
    SamplesPerPixel: numberOfComponents,
  } = dataSet

  const [rowPixelSpacing, columnPixelSpacing] = pixelSpacing || []
  const isColorImage = imageFrameUtils.is.colorImage(imageFrame)

  // JPEGBaseline (8 bits) is already returning the pixel data in the right format (rgba)
  // because it's using a canvas to load and decode images.
  if (!imageFrameUtils.is.jpegBaseline8BitColor(imageFrame, transferSyntax)) {
    if (!alreadyTyped) {
      imageFrameUtils.convert.pixelDataType(imageFrame)
    }

    // convert color space
    if (isColorImage) {
      const context = canvas.getContext("2d")
      const imageData = context.createImageData(
        imageFrame.columns,
        imageFrame.rows
      )

      // imageData.data is being changed by reference.
      imageFrameUtils.convert.colorSpace(imageFrame, imageData.data)
      if (!imageData.data) {
        throw new Error("Missing image data after converting color space")
      }
      imageFrame.imageData = imageData
      imageFrame.pixelData = imageData.data
    }
  }

  if (
    (!imageFrame.smallestPixelValue ||
      !imageFrame.largestPixelValue ||
      imageFrame.pixelData.constructor,
    originalDataConstructor)
  ) {
    // calculate smallest and largest PixelValue of the converted pixelData
    const { min, max } = imageFrameUtils.get.pixelDataMinMax(
      imageFrame.pixelData
    )

    imageFrame.smallestPixelValue = min
    imageFrame.largestPixelValue = max
  }

  const { columns, rows } = imageFrame

  const rgba = imageFrame.pixelData.length === rows * columns * 4
  const image: IImage = {
    imageId: "internal",
    isPreScaled: imageFrame.preScale,
    color: isColorImage,
    columnPixelSpacing,
    columns,
    height: imageFrame.rows,
    intercept,
    slope,
    invert: imageFrame.photometricInterpretation === "MONOCHROME1",
    minPixelValue: imageFrame.smallestPixelValue,
    maxPixelValue: imageFrame.largestPixelValue,
    rowPixelSpacing,
    rows,
    sizeInBytes: imageFrame.pixelData.byteLength,
    width: columns,
    voiLUTFunction: VOILUTFunctionType.LINEAR,
    windowCenter,
    windowWidth,
    decodeTimeInMS: imageFrame.decodeTimeInMS,
    getPixelData: null,
    getCanvas: null,
    modalityLUT: null,
    voiLUT: null,
    rgba,
    dataType: null,
    numberOfComponents,
    voxelManager: utilities.VoxelManager.createImageVoxelManager({
      width: columns,
      height: rows,
      scalarData: imageFrame.pixelData,
      numberOfComponents: rgba ? 4 : numberOfComponents,
    }),
  }

  // If pixel data is intrinsically floating 32 array, we convert it to int for
  // display in cornerstone. For other cases when pixel data is typed as
  // Float32Array for scaling; this conversion is not needed.
  if (
    imageFrame.pixelData instanceof Float32Array &&
    convertFloatPixelDataToInt
  ) {
    const floatPixelData = imageFrame.pixelData
    const results = imageFrameUtils.get.pixelDataIntType(floatPixelData)

    image.minPixelValue = results.min
    image.maxPixelValue = results.max
    image.slope = results.slope
    image.intercept = results.intercept
    // image.floatPixelData = floatPixelData
    image.getPixelData = () => results.intPixelData
  } else {
    image.getPixelData = () => imageFrame.pixelData
  }

  if (image.color && imageFrame.imageData) {
    // let lastImageIdDrawn;
    image.getCanvas = () => {
      canvas.height = image.rows
      canvas.width = image.columns
      const context = canvas.getContext("2d")

      context.putImageData(imageFrame.imageData, 0, 0)

      return canvas
    }
  }

  // Modality LUT
  if (
    modalityLUTSequence &&
    modalityLUTSequence.length > 0 &&
    imageFrameUtils.is.modalityLut(sopClassUID)
  ) {
    image.modalityLUT = modalityLUTSequence[0]
  }

  // VOI LUT
  if (voiLUTSequence && voiLUTSequence.length > 0) {
    image.voiLUT = voiLUTSequence[0]
  }

  if (image.color) {
    image.windowWidth = 256
    image.windowCenter = 128
  }

  // set the ww/wc to cover the dynamic range of the image if no values are supplied
  if (image.windowCenter === undefined || image.windowWidth === undefined) {
    const maxVoi = image.maxPixelValue * image.slope + image.intercept
    const minVoi = image.minPixelValue * image.slope + image.intercept

    image.windowWidth = maxVoi - minVoi + 1
    image.windowCenter = (maxVoi + minVoi + 1) / 2
  }

  return image
}

export default createImage
