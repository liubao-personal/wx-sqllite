const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 要读取的文件夹路径
const folderPath = './';

// 获取文件夹中的所有文件
const files = fs.readdirSync(folderPath);

// 过滤出 .db 文件
const dbFiles = files.filter(file => path.extname(file) === '.db');
// 解密出来的最后一个db文件
const lastDbFile = dbFiles[dbFiles.length - 1];

// 创建一个数据库连接
// 微信数据库
const microDb = new sqlite3.Database('MicroMsg.db');
// 最新的解密db库连接
const msgDb = new sqlite3.Database(lastDbFile);

// 微信基础数据
microDb.serialize(() => {
  microDb.each('SELECT * FROM MicroMsg limit 10', (err, row) => {
    if (err) {
      console.error('microDb',err.message);
    } else {
      let BytesExtra = row.BytesExtra
      BytesExtra = BytesExtra.toString('utf-8')
      console.log(row.localId, row.StrContent, BytesExtra);
    }
  });
})

// 查询msg数据
msgDb.serialize(() => {
  msgDb.each('SELECT * FROM MSG limit 10', (err, row) => {
    if (err) {
      console.error('msgDb',err.message);
    } else {
      let BytesExtra = row.BytesExtra
      BytesExtra = BytesExtra.toString('utf-8')
      console.log(row.localId, row.StrContent, BytesExtra);
    }
  });
});

// 等待一段时间后退出应用程序
setTimeout(() => {
  microDb.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('microDb数据库连接已关闭');
    }
  })
  msgDb.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('msg数据库连接已关闭');
    }
    process.exit(); // 退出应用程序
  });
}, 5000); // 5秒后退出
