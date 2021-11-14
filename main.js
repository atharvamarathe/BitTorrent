const Client = require("./src/client.js");
const Torrent = require("./src/torrent.js");
const _progress = require("cli-progress");
// const readline = require("readline").createInterface({
//   input: process.stdin,
//   output: process.stdout,
// });
const { ArgumentParser } = require("argparse");

const getParser = () => {
  const parser = new ArgumentParser({
    description: "BitTorrent Client",
  });

  parser.add_argument("files", { nargs: "+" });

  parser.add_argument("-s", "--download-path", {
    help: "Path to save downloaded files",
  });

  parser.add_argument("-m", "--max-connections", {
    help: "Maximum Peer Connections",
  });

  parser.add_argument("-us", "--upload-limit", {
    help: "Maximum Upload Speed",
  });

  parser.add_argument("-ds", "--download-limit", {
    help: "Maximum Download Speed",
  });
  parser.add_argument("-p", "--port", {
    help: "Port of the BitTorrent Application",
  });

  parser.add_argument("-log", {
    help: "Enable logging",
  });
  return parser;
};

function main() {
  const args = getParser().parse_args();
  const files = args.files;
  const client = new Client({ port: args.port });
  const torrents = [];
  for (const f of files) {
    const options = {
      downloadPath: args.download_path,
      uploadLimit: args.upload_limit,
      downloadLimit: args.download_limit,
      maxConnections: args.max_connections,
    };
    const torrent = client.addTorrent(f, options);
    const progressBar = new _progress.Bar({}, _progress.Presets.shades_classic);
    progressBar.start(torrent.numPieces, 0);
    torrent.start((event, data) => {
      if (event === "progress") {
        progressBar.update(data.numDone);
      }
      if (event === "saved") {
        progressBar.stop();
      }
      if (event === "rate-update") {
        const downSpeed = data.downSpeed;
        const upSpeed = data.upSpeed;
      }
    });
    torrents.push(torrent);
  }
}

main();
