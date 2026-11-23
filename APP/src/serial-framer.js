"use strict";

// Split COM port chunks without accepting partial lines as readings.
function decodeLineEnding(value) {
  const endings = { "\\r\\n": "\r\n", "\\n": "\n", "\\r": "\r" };
  if (Object.hasOwn(endings, value)) return endings[value];
  if (["\r\n", "\n", "\r"].includes(value)) return value;
  throw new Error("Select a valid scale line ending in Configuration.");
}

function createSerialFramer({ onLine, onOverflow, maxLength = 65536, delimiter = null }) {
  let buffer = "";
  let controlFrames = false;
  let controlFrame = null;
  return {
    push(chunk) {
      const input = chunk.toString("utf8");
      if (controlFrames || input.includes("\x02")) {
        controlFrames = true;
        buffer = "";
        for (const character of input) {
          if (character === "\x02") {
            if (controlFrame !== null) onOverflow();
            controlFrame = "\x02";
          } else if (controlFrame !== null) {
            controlFrame += character;
            if (character === "\x03") {
              onLine(controlFrame);
              controlFrame = null;
            } else if (controlFrame.length > maxLength) {
              controlFrame = null;
              onOverflow();
            }
          }
        }
        return;
      }
      buffer += input;
      if (buffer.length > maxLength) { buffer = ""; onOverflow(); return; }
      const lines = buffer.split(delimiter || /\r\n|\r|\n/);
      buffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) onLine(line);
    },
    reset() { buffer = ""; controlFrames = false; controlFrame = null; }
  };
}
module.exports = { createSerialFramer, decodeLineEnding };
