const sqlite3 = require("sqlite3");

const db = new sqlite3.Database("app.db");

function getPostsByAuthor(author, cb) {
  db.all(`SELECT * FROM posts WHERE author = '${author}'`, cb);
}

module.exports = { getPostsByAuthor };
