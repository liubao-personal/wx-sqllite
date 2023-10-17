const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// 读取配置信息文件
const config = require(path.join(process.cwd(), './config.json'));
const weChatInfo = require(path.join(process.cwd(), './wechat_info.json'));


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
const BATCH_SIZE = config.BATCH_SIZE; // 分割条数
const BATCH_SIZE_MSG = config.BATCH_SIZE_MSG; // 分割条数-消息
const DELAY_BETWEEN_REQUESTS = config.DELAY_BETWEEN_REQUESTS; // 延迟时间ms

// 延迟时长方法
function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

// 正则匹配出解析二进制得到的首个字符串
function decodeUnicodeEscapes(input) {
  const regex = /[\w\d-@$]+/g;
  const match = input.match(regex);
  return match ? match[0].trim() : null;
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

  // 根据传递的 URL 决定使用 http 或 https 模块
  const httpModule = config.httpModule === 'https' ? https : http;

  const options = {
    hostname: config.hostname,
    port: config.port,
    path: url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  const req = httpModule.request(options, (res) => {
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
  const countPage = Math.ceil(count / BATCH_SIZE);
  writeLog(`[微信群条数]：${JSON.stringify(count)},共${countPage}页`);

  const sendRequests = async () => {
    for (let i = 0; i < count; i += BATCH_SIZE) {

      const rows = await queryDatabase('SELECT ChatRoom.*,ChatRoomInfo.Announcement,Contact.NickName,Contact.Remark FROM ChatRoom LEFT JOIN ChatRoomInfo ON ChatRoom.ChatRoomName = ChatRoomInfo.ChatRoomName LEFT JOIN Contact ON ChatRoom.ChatRoomName = Contact.UserName limit ? offset ?', [BATCH_SIZE, i]);
      let UserNames = rows.map(row => row.Reserved2);
      UserNames = '\'' + UserNames.join('\',\'') + '\'';
      const contactRows = await queryDatabase('SELECT UserName,NickName,Remark FROM Contact WHERE UserName in (' + UserNames + ')');

      rows.forEach(row => {
        if (row.RoomData) {
          row.RoomData = '';
        }
        row.ChatRoomNameRemark = row.Remark ? row.Remark: row.NickName;
        row.pusherAccount = weChatInfo['Account'];
        row.pusherNickName = weChatInfo['NickName'];
        row.pusherMobile = weChatInfo['Mobile'];
        row.pusherKey = weChatInfo['Key'];
        const contact = contactRows.find(contact => contact.UserName === row.Reserved2);
        if (contact) {
          row.Reserved2NickName = contact.Remark ? contact.Remark : contact.NickName;
        }
      });
      const pageNum = Math.ceil(i / BATCH_SIZE) + 1;

      // writeLog(`[推送chatroomList第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomUrl}`)}, body: ${JSON.stringify({
      //   list: rows
      // })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomUrl}`, rows, pageNum);
      writeLog(`[推送微信群进度]：${Math.floor(pageNum / countPage * 100)}%`);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }

  await sendRequests();
}

// 同步社群成员
async function chatRoomMembersFunction() {
  const chatRoomRows = await queryDatabase('SELECT ChatRoom.ChatRoomName,Contact.Nickname,Contact.Remark,ChatRoom.UserNameList FROM ChatRoom LEFT JOIN Contact ON ChatRoom.ChatRoomName = Contact.UserName');
  writeLog(`[微信群成员页数]：${JSON.stringify(chatRoomRows.length)}`);
  for (let i = 0; i < chatRoomRows.length; i++) {
    const row = chatRoomRows[i];
    const chatRoomName = row.ChatRoomName; // 群id
    const chatRoomNameRemark = row.Remark ? row.Remark : row.NickName; // 群名称
    let userNameList = row.UserNameList;
    userNameList = userNameList.split('^G'); // 群成员数组
    let userNameListStr = '\'' + userNameList.join('\',\'') + '\'';
    const contactRows = await queryDatabase('SELECT * FROM Contact WHERE UserName in (' + userNameListStr + ')');
    let chatRoomMemberRows = [];
    for (let j = 0; j < userNameList.length; j++) {
      const userName = userNameList[j];
      const contact = contactRows.find(contact => contact.UserName === userName);
      if (contact) {
        const chatRoomMemberRow = {
          ChatRoomName: chatRoomName,
          ChatRoomNameRemark: chatRoomNameRemark,
          UserName: userName,
          Alias: contact.Alias,
          NickName: contact.NickName,
          Remark: contact.Remark,
          PusherAccount: weChatInfo['Account'],
          PusherNickName: weChatInfo['NickName'],
          PusherMobile: weChatInfo['Mobile'],
          PusherKey: weChatInfo['Key']
        };
        chatRoomMemberRows.push(chatRoomMemberRow);
      }
    }
    // 推送群成员
    await pushDataToServer(`${config.url + config.pushChatRoomMemberUrl}`, chatRoomMemberRows, i + 1);
  }
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
  const countPage = Math.ceil(chatRoomInfoList.length / BATCH_SIZE);

  writeLog(`[微信群公告条数]：${JSON.stringify(chatRoomInfoList.length)},共${countPage}页`);

  const chunkedRequests = [];

  for (let i = 0; i < chatRoomInfoList.length; i += BATCH_SIZE) {
    chunkedRequests.push(chatRoomInfoList.slice(i, i + BATCH_SIZE));
  }
  const sendRequests = async () => {
    for (let i = 0; i < chunkedRequests.length; i++) {
      const chunkedArray = chunkedRequests[i];
      const pageNum = i + 1;

      // writeLog(`[推送chatroomInfo第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushChatRoomInfoUrl}`)}, body: ${JSON.stringify({
      //   list: chunkedArray
      // })}`);

      await pushDataToServer(`${config.url + config.pushChatRoomInfoUrl}`, chunkedArray, pageNum);
      writeLog(`[推送微信群公告进度]：${Math.floor(pageNum / countPage * 100)}%`);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  };
  await sendRequests();

}

// 推送微信联系人
async function contactFunction() {
  const [{ count }] = await queryDatabase('SELECT count(1) as count FROM Contact');
  const countPage = Math.ceil(count / BATCH_SIZE);
  writeLog(`[微信联系人条数]：${JSON.stringify(count)},共${countPage}页`);
  const sendRequests = async () => {
    for (let i = 0; i < count; i += BATCH_SIZE) {
      const rows = await queryDatabase('SELECT Contact.*,ContactHeadImgUrl.smallHeadImgUrl, ContactHeadImgUrl.bigHeadImgUrl FROM Contact LEFT JOIN ContactHeadImgUrl ON Contact.UserName = ContactHeadImgUrl.usrName limit ? offset ?', [BATCH_SIZE, i]);
      rows.forEach(row => {
        if (row.ExtraBuf) {
          row.ExtraBuf = '';
        }
        if (row.VerifyFlag === 0) {
          if ([2, 268435458].includes(row.Type) || [1].includes(row.ChatRoomNotify) || row.UserName.includes('@chatroom')) { // 社群和折叠的社群
            row.ContactType = 2; // 社群
          } else if ([4].includes(row.Type)) {
            row.ContactType = 3; // 群友
          } else {
            row.ContactType = 1; // 好友
          }
        } else {
          row.ContactType = 4; // 公众号
        }

        row.pusherAccount = weChatInfo['Account'];
        row.pusherNickName = weChatInfo['NickName'];
        row.pusherMobile = weChatInfo['Mobile'];
        row.pusherKey = weChatInfo['Key'];
      });
      const pageNum = Math.ceil(i / BATCH_SIZE) + 1;
      // writeLog(`[推送微信联系人第${pageNum}页]：url: ${JSON.stringify(`${config.url + config.pushContactUrl}`)}, body: ${JSON.stringify({
      //   list: rows
      // })}`);
      await pushDataToServer(`${config.url + config.pushContactUrl}`, rows, pageNum);
      writeLog(`[推送微信联系人进度]：${Math.floor(pageNum / countPage * 100)}%`);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }
  await sendRequests();
}

(async () => {
  try {
    await chatRoomFunction(); // 同步微信群
    // await chatRoomInfoFunction(); // 同步微信群公告
    await contactFunction(); // 头像微信联系人（关联联系人头像后一起传输）
    await msgFunction();
    await chatRoomMembersFunction(); // 同步微信群成员
  } catch (error) {
    console.error('Error:', error);
    process.exit(); // 退出应用程序
  }
})();

// 同步微信消息
async function msgFunction() {
  const [{ count }] = await queryMsgDatabase('SELECT count(1) as count FROM MSG');
  const countPage = Math.ceil(count / BATCH_SIZE_MSG);
  writeLog(`[微信消息条数]：${JSON.stringify(count)},共${countPage}页`);

  const queryContactDatabase = async (UserNames) => {
    return await queryDatabase('SELECT UserName,NickName,Remark FROM Contact WHERE UserName in (' + UserNames + ')');
  };
  const sendRequests = async () => {
    for (let i = 0; i < count; i += BATCH_SIZE_MSG) {
      const rows = await queryMsgDatabase('SELECT * FROM MSG limit ? offset ?', [BATCH_SIZE_MSG, i]);
      rows.forEach(row => {
        row.pusherAccount = weChatInfo['Account'];
        row.pusherNickName = weChatInfo['NickName'];
        row.pusherMobile = weChatInfo['Mobile'];
        row.pusherKey = weChatInfo['Key'];
        if (row.CreateTime) {
          const date = new Date(row.CreateTime * 1000);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const seconds = String(date.getSeconds()).padStart(2, '0');
          row.SendTime  = year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
          delete row.CreateTime;
        }
        if (row.CompressContent) {
          row.CompressContent = '';
        }
        if (row.BytesExtra && (row.StrTalker && row.StrTalker.includes("@chatroom"))) {
          let BytesExtra = row.BytesExtra.toString('utf8');
          BytesExtra = decodeUnicodeEscapes(BytesExtra);
          row.Talker = BytesExtra; // 消息发送人
          if (BytesExtra.length < 3) {
            row.Talker = '';
            row.StrTalkerNickName = '公告消息';
          }
          if (row.IsSender === 1) { // 群中本人发的消息把发送人改成采集人
            row.Talker = weChatInfo.Account;
            row.TalkerNickName = weChatInfo.NickName;
          }
          row.MsgType = 1; // 群聊
        } else if (row.IsSender === 1) { // 本人发的消息
          row.StrTalkerNickName = weChatInfo.NickName;
          row.MsgType = 2; // 单聊
          row.Talker = weChatInfo.Account;
          row.TalkerNickName = weChatInfo.NickName;
        } else {
          row.Talker = row.StrTalker
          row.StrTalkerNickName = row.StrTalker
          row.MsgType = 2; // 单聊
        }
        row.BytesExtra = ''
        if (row.BytesTrans) {
          row.BytesTrans = '';
        }
      });
      let UserNames = rows.map(row => row.Talker);
      UserNames = '\'' + UserNames.join('\',\'') + '\'';

      let StrTalkers = rows.map(row => row.StrTalker);
      StrTalkers = '\'' + StrTalkers.join('\',\'') + '\'';
      const [contactRows, StrTalkerRows] = await Promise.all([queryContactDatabase(UserNames), queryContactDatabase(StrTalkers)]);
      rows.forEach(row => {
        const contact = contactRows.find(contact => contact.UserName === row.Talker);
        if (contact) {
          row.TalkerNickName = contact.Remark ? contact.Remark : contact.NickName;
        }
        const StrTalker = StrTalkerRows.find(StrTalker => StrTalker.UserName === row.StrTalker);
        if (StrTalker) {
          row.StrTalkerNickName = StrTalker.Remark ? StrTalker.Remark : StrTalker.NickName;
        }
      })
      const pageNum = Math.ceil(i / BATCH_SIZE_MSG) + 1;
      await pushDataToServer(`${config.url + config.pushMsgUrl}`, rows, pageNum);
      writeLog(`[推送微信消息进度]：${Math.floor(pageNum / countPage * 100)}%`);
      await delay(DELAY_BETWEEN_REQUESTS);
    }
  }

  await sendRequests();
}


