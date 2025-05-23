/* eslint-disable import/prefer-default-export */
import fs from "fs";
import path from "path";
import childProcess from "node:child_process";
import {
  extractMultipart,
  uint8ArrayToString,
  execSpawn,
  handleHomeRelative,
} from "@radicalimaging/static-wado-util";

const createCommandLine = (args, commandName, params) => {
  let commandline = commandName;
  const { listFiles = [], studyUIDs } = args;

  commandline = commandline.replace(
    /<files>/,
    listFiles.map((file) => file.filepath).join(" ")
  );
  commandline = commandline.replace(
    /<rootDir>/,
    path.resolve(handleHomeRelative(params.rootDir))
  );
  if (studyUIDs?.size) {
    commandline = commandline.replace(
      /<studyUIDs>/,
      Array.from(studyUIDs).join(" ")
    );
  } else {
    console.warn(
      "No study uid found, not running command",
      commandName,
      studyUIDs
    );
    return null;
  }
  return commandline;
};

/**
 * Save files using stow service, using the given stow command (from params)
 *
 * @param {*} files files to be stored
 * @param {*} params
 */
export const storeFilesByStow = (stored, params = {}) => {
  const { stowCommands = [], notificationCommand, verbose = false } = params;
  const { listFiles, studyUIDs } = stored;

  const promises = [];
  for (const commandName of stowCommands) {
    const command = createCommandLine(stored, commandName, params);
    if (!command) {
      continue;
    }
    console.log("Store command", command);
    const commandPromise = execSpawn(command);
    promises.push(commandPromise);
  }

  return Promise.allSettled(promises).then(() => {
    if (notificationCommand) {
      console.warn("Executing notificationCommand", notificationCommand);
      execSpawn(notificationCommand);
    }
    listFiles.forEach((item) => {
      const { filepath } = item;
      console.verbose("Unlinking", filepath);
      fs.unlink(filepath, () => null);
    });
    return listFiles.map((it) => it.filepath);
  });
};

const executablePath = process.argv[1];
const bunExecPath = path.join(
  path.dirname(executablePath),
  "..",
  "..",
  "static-wado-creator",
  "bin",
  "mkdicomweb.mjs"
);

/** Creates a separated child process */
function spawnInstances(cmdLine) {
  return new Promise((resolve, reject) => {
    try {
      console.log("Spawning instance", cmdLine);
      const child = childProcess.spawn(cmdLine, {
        shell: true,
        stdio: ["inherit", "overlapped", "inherit"],
      });
      let inputData = [];
      child.stdout.on("data", (data) => {
        inputData.push(data);
      });
      child.on("close", (code) => {
        const resultStr = inputData.join("");
        const jsonResponse = extractMultipart("multipart/related", resultStr);
        const jsonStr = uint8ArrayToString(jsonResponse.pixelData).trim();
        const json = JSON.parse(jsonStr);
        json.code = code;

        resolve(json);
      });
    } catch (e) {
      reject(e);
    }
  });
}

export const storeFileInstance = (item, params = {}) => {
  console.log("storeFileInstance", item);
  const cmd = [
    "bun",
    "run",
    bunExecPath,
    "instance",
    "--quiet",
    "--stow-response",
    item,
  ];
  const cmdLine = cmd.join(" ");
  return spawnInstances(cmdLine);
};
