const Client = require("./src/client.js");
const _progress = require("cli-progress");
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
    const progressBar = new _progress.SingleBar(
      {
        format:
          "\x1b[35mTorrent Progress\x1b[32m {bar} \x1b[31m{percentage}% | \x1b[36mETA: {eta}s |\x1b[33m {value}/{total}" +
          " \x1b[37mSpeed: {Speed}",
      },
      _progress.Presets.shades_classic
    );
    progressBar.start(torrent.numPieces, 0, { Speed: "N/A" });
    let numDone = 0;
    torrent.start((event, data) => {
      if (event === "progress") {
        progressBar.update(data.numDone);
        numDone = data.numDone;
      }
      if (event === "saved") {
        progressBar.stop();
        client.closeSeeder();
      }
      if (event === "rate-update") {
        // console.log(data);
        const downSpeed = Math.floor(data.downSpeed / 1024);
        if (downSpeed < 1000) {
          progressBar.update(numDone, {
            Speed: Math.floor(downSpeed / 1024) + "Kb/s",
          });
        } else {
          progressBar.update(numDone, {
            Speed: Math.floor(downSpeed / 1024) + "Mb/s",
          });
        }
      }
    });
    torrents.push(torrent);
  }
}

main();
