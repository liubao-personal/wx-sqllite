const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const http = require('http');

// 读取配置信息文件
const config = require('./config.json');
const weChatInfo = require('./wechat_info.json');


function writeLog(logMessage) {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
  const day = currentDate.getDate().toString().padStart(2, '0');
  const formattedDate = `${year}-${month}-${day}`;
  const currentDateTime = currentDate.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');

  const logDirectory = './logs';
  const logFilePath = path.join(logDirectory, `${formattedDate}.log`);
  logMessage = '\n' + formattedDate + ' ' + currentDateTime + '\n' + logMessage;

  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
  }

  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) {
      console.error('Error writing log:', err);
    } else {
      console.log(logMessage);
    }
  });
}

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
const BATCH_SIZE = 100; // 分割条数
const DELAY_BETWEEN_REQUESTS = 1000; // 1秒的延迟

// 延迟时长方法
function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// 查询数据库并返回 Promise
function queryDatabase(query, params) {
  return new Promise((resolve, reject) => {
    microDb.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function queryMsgDatabase(query, params) {
  return new Promise((resolve, reject) => {
    msgDb.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// 推送数据至服务器
async function pushDataToServer(url, data, pageNum) {
  const postData = JSON.stringify({
    list: data
  });

  const options = {
    hostname: config.hostname,
    port: config.port,
    path: url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const req = http.request(options, (res) => {
    let responseBody = '';

    res.on('data', (chunk) => {
      responseBody += chunk;
    });

    res.on('end', () => {
      writeLog(`[推送${url}第${pageNum}页结果]：` + responseBody);
    });
  });

  req.on('error', (error) => {
    console.error('Error:', error);
  });

  req.write(postData);
  req.end();
}

// chatroom同步方法
async function chatRoomFunction() {
  // 同步chatroom表
  const [{ count }] = await queryDatabase('SELECT count(1) as count FROM ChatRoom');

  writeLog(`[chatroom微信群条数]：${JSON.stringify(count)}`);

  const chatroomList = [];

  for (let i = 0; i < count; i += BATCH_SIZE) {
    writeLog(`[chatroom查询微信群页数]第${Math.ceil(i / BATCH_SIZE) + 1}页`);

    const rows = await queryDatabase('SELECT * FROM ChatRoom limit ? offset ?', [BATCH_SIZE, i]);

    rows.forEach(row => {
      if (row.RoomData) {
        row.RoomData = '';
      }
      row.pusherAccount = weChatInfo['Account'];
      row.pusherNickName = weChatInfo['NickName'];
      row.pusherMobile = weChatInfo['Mobile'];
      row.pusherKey = weChatInfo['Key'];
      chatroomList.push(row);
    });
  }

  const chunkedRequests = [];

  for (let i = 0; i < chatroomList.length; i += BATCH_SIZE) {
    chunkedRequests.push(chatroomList.slice(i, i + BATCH_SIZE));
  }

  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;

      writeLog(`[推送chatroomList第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomUrl}`)}, body: ${JSON.stringify({
        list: chunkedArray
      })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomUrl}`, chunkedArray, pageNum);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  };

  await sendRequests();
}

// chatroomInfo同步方法
async function chatRoomInfoFunction() {
  const chatRoomInfoList = await queryDatabase('SELECT * FROM ChatRoomInfo');
  chatRoomInfoList.forEach(row => {
    row.pusherAccount = weChatInfo['Account'];
    row.pusherNickName = weChatInfo['NickName'];
    row.pusherMobile = weChatInfo['Mobile'];
    row.pusherKey = weChatInfo['Key'];
  });


  const chunkedRequests = [];

  for (let i = 0; i < chatRoomInfoList.length; i += BATCH_SIZE) {
    chunkedRequests.push(chatRoomInfoList.slice(i, i + BATCH_SIZE));
  }
  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;

      writeLog(`[推送chatroomInfo第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomInfoUrl}`)}, body: ${JSON.stringify({
        list: chunkedArray
      })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomInfoUrl}`, chunkedArray, pageNum);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  };
  sendRequests();

}

// 推送微信联系人
async function contactFunction() {
  const [{ count }] = await queryDatabase('SELECT count(1) as count FROM Contact');
  writeLog(`[微信联系人条数]：${JSON.stringify(count)}`);
  const contactList = [];
  for (let i = 0; i < count; i += BATCH_SIZE) {
    writeLog(`[微信联系人查询第${Math.ceil(i / BATCH_SIZE) + 1}页]`);
    const rows = await queryDatabase('SELECT Contact.*,ContactHeadImgUrl.smallHeadImgUrl, ContactHeadImgUrl.bigHeadImgUrl FROM Contact LEFT JOIN ContactHeadImgUrl ON Contact.UserName = ContactHeadImgUrl.usrName limit ? offset ?', [BATCH_SIZE, i]);
    rows.forEach(row => {
      if (row.ExtraBuf) {
        row.ExtraBuf = '';
      }
      row.pusherAccount = weChatInfo['Account'];
      row.pusherNickName = weChatInfo['NickName'];
      row.pusherMobile = weChatInfo['Mobile'];
      row.pusherKey = weChatInfo['Key'];
      contactList.push(row);
    });
  }
  const chunkedRequests = [];
  for (let i = 0; i < contactList.length; i += BATCH_SIZE) {
    chunkedRequests.push(contactList.slice(i, i + BATCH_SIZE));
  }

  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;
      writeLog(`[推送微信联系人第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushContactUrl}`)}, body: ${JSON.stringify({
        list: chunkedArray
      })}`);
      await pushDataToServer(`${config.url + config.pushContactUrl}`, chunkedArray, pageNum);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }
  sendRequests();
}

microDb.serialize(async () => {
  try {
    await chatRoomFunction(); // 同步微信群
    await chatRoomInfoFunction(); // 同步微信群公告
    await contactFunction(); // 头像微信联系人（关联联系人头像后一起传输）
  } catch (error) {
    console.error('Error:', error);
    process.exit(); // 退出应用程序
  }
});


// 查询msg数据
msgDb.serialize(() => {
  msgDb.each('SELECT * FROM MSG limit 10', (err, row) => {
    if (err) {
      console.error('msgDb', err.message);
    } else {
      let BytesExtra = row.BytesExtra
      BytesExtra = BytesExtra.toString('utf-8')
      // console.log(row.localId, row.StrContent, BytesExtra);
    }
  });
});

