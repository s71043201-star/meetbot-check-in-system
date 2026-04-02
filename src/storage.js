const admin = require("firebase-admin");

const BUCKET_NAME = "meetbot-check-in-file.firebasestorage.app";

// 初始化 Firebase Admin（使用環境變數中的 service account）
if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: BUCKET_NAME,
    });
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT 未設定，檔案上傳功能不可用");
    admin.initializeApp({ storageBucket: BUCKET_NAME });
  }
}

const bucket = admin.storage().bucket();

async function uploadFile(fileBuffer, fileName, mimeType, sessionId) {
  const path = `uploads/${sessionId}/${Date.now()}_${fileName}`;
  const file = bucket.file(path);

  await file.save(fileBuffer, {
    metadata: { contentType: mimeType },
  });

  // 產生公開下載 URL
  await file.makePublic();
  const url = `https://storage.googleapis.com/${BUCKET_NAME}/${path}`;

  return { name: fileName, url, path };
}

module.exports = { uploadFile };
