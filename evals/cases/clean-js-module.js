const path = require("node:path");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

module.exports = { toPosix, chunk };
