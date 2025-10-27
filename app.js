require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { Octokit } = require('@octokit/rest');
const cron = require('node-cron');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ========================================
// KONFIGURASI - ISI DENGAN DATA ANDA
// ========================================
const  TOKEN = process.env.TOKEN; // Personal Access Token
const  OWNER = process.env.OWNER; // Username GitHub
const  REPO = process.env.REPO; // Nama repository
const  BRANCH = 'main'; // Branch yang digunakan

const octokit = new Octokit({ auth: TOKEN });

// Fungsi untuk upload file ke GitHub
async function uploadToGitHub(fileName, fileContent) {
  const timestamp = Date.now();
  const filePath = `temp/${timestamp}_${fileName}`;
  
  try {
    const response = await octokit.repos.createOrUpdateFileContents({
      owner:  OWNER,
      repo:  REPO,
      path: filePath,
      message: `Upload ${fileName} - expires in 24h`,
      content: fileContent.toString('base64'),
      branch:  BRANCH
    });

    const fileUrl = `https://raw.githubusercontent.com/${ OWNER}/${ REPO}/${ BRANCH}/${filePath}`;
    
    return {
      success: true,
      url: fileUrl,
      path: filePath,
      sha: response.data.content.sha,
      expiresAt: new Date(timestamp + 24 * 60 * 60 * 1000)
    };
  } catch (error) {
    console.error('Error uploading to GitHub:', error);
    throw error;
  }
}

// Fungsi untuk menghapus file dari GitHub
async function deleteFromGitHub(filePath) {
  try {
    // Dapatkan SHA file terlebih dahulu
    const { data } = await octokit.repos.getContent({
      owner:  OWNER,
      repo:  REPO,
      path: filePath,
      branch:  BRANCH
    });

    await octokit.repos.deleteFile({
      owner:  OWNER,
      repo:  REPO,
      path: filePath,
      message: `Auto-delete expired file: ${filePath}`,
      sha: data.sha,
      branch:  BRANCH
    });

    console.log(`Deleted: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error deleting ${filePath}:`, error.message);
    return false;
  }
}

// Fungsi untuk mendapatkan semua file di folder temp
async function getTempFiles() {
  try {
    const { data } = await octokit.repos.getContent({
      owner:  OWNER,
      repo:  REPO,
      path: 'temp',
      branch:  BRANCH
    });

    return Array.isArray(data) ? data : [data];
  } catch (error) {
    if (error.status === 404) {
      return []; // Folder belum ada
    }
    throw error;
  }
}

// Fungsi untuk membersihkan file yang sudah expired
async function cleanupExpiredFiles() {
  console.log('Running cleanup task...');
  const files = await getTempFiles();
  const now = Date.now();
  const oneDayInMs = 24 * 60 * 60 * 1000;

  for (const file of files) {
    // Extract timestamp dari nama file
    const match = file.name.match(/^(\d+)_/);
    if (match) {
      const fileTimestamp = parseInt(match[1]);
      const age = now - fileTimestamp;

      if (age > oneDayInMs) {
        await deleteFromGitHub(file.path);
      }
    }
  }
}

// Endpoint untuk upload file
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await uploadToGitHub(req.file.originalname, req.file.buffer);
    
    res.json({
      message: 'File uploaded successfully',
      url: result.url,
      fileName: req.file.originalname,
      expiresAt: result.expiresAt,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to upload file',
      details: error.message 
    });
  }
});

// Endpoint untuk mendapatkan daftar file
app.get('/files', async (req, res) => {
  try {
    const files = await getTempFiles();
    const now = Date.now();

    const fileList = files.map(file => {
      const match = file.name.match(/^(\d+)_(.+)$/);
      if (match) {
        const timestamp = parseInt(match[1]);
        const originalName = match[2];
        const expiresAt = new Date(timestamp + 24 * 60 * 60 * 1000);
        const url = `https://raw.githubusercontent.com/${ OWNER}/${ REPO}/${ BRANCH}/${file.path}`;

        return {
          name: originalName,
          url: url,
          uploadedAt: new Date(timestamp),
          expiresAt: expiresAt,
          isExpired: Date.now() > expiresAt.getTime()
        };
      }
      return null;
    }).filter(Boolean);

    res.json({ files: fileList });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch files',
      details: error.message 
    });
  }
});

// HTML Form sederhana untuk testing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>GitHub Temp File Uploader</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .upload-box { border: 2px dashed #ccc; padding: 40px; text-align: center; border-radius: 8px; }
        input[type="file"] { margin: 20px 0; }
        button { background: #0366d6; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
        button:hover { background: #0256c7; }
        .result { margin-top: 20px; padding: 15px; background: #f6f8fa; border-radius: 5px; }
        .link { color: #0366d6; word-break: break-all; }
      </style>
    </head>
    <body>
      <h1>🚀 GitHub Temp File Uploader</h1>
      <p>Upload file yang akan tersimpan selama 24 jam</p>
      
      <div class="upload-box">
        <input type="file" id="fileInput" />
        <br>
        <button onclick="uploadFile()">Upload File</button>
      </div>
      
      <div id="result"></div>

      <script>
        async function uploadFile() {
          const fileInput = document.getElementById('fileInput');
          const resultDiv = document.getElementById('result');
          
          if (!fileInput.files[0]) {
            alert('Pilih file terlebih dahulu!');
            return;
          }

          const formData = new FormData();
          formData.append('file', fileInput.files[0]);

          resultDiv.innerHTML = '<p>Uploading...</p>';

          try {
            const response = await fetch('/upload', {
              method: 'POST',
              body: formData
            });

            const data = await response.json();

            if (response.ok) {
              resultDiv.innerHTML = \`
                <div class="result">
                  <h3>✅ Upload Berhasil!</h3>
                  <p><strong>File:</strong> \${data.fileName}</p>
                  <p><strong>Size:</strong> \${(data.size / 1024).toFixed(2)} KB</p>
                  <p><strong>Expires:</strong> \${new Date(data.expiresAt).toLocaleString()}</p>
                  <p><strong>Link:</strong><br>
                  <a href="\${data.url}" target="_blank" class="link">\${data.url}</a></p>
                </div>
              \`;
            } else {
              resultDiv.innerHTML = \`<div class="result">❌ Error: \${data.error}</div>\`;
            }
          } catch (error) {
            resultDiv.innerHTML = \`<div class="result">❌ Error: \${error.message}</div>\`;
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Jalankan cleanup setiap 1 jam
cron.schedule('0 * * * *', () => {
  cleanupExpiredFiles();
});

// Jalankan cleanup saat startup
cleanupExpiredFiles();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('GitHub configuration:');
  console.log(`- Owner: ${ OWNER}`);
  console.log(`- Repo: ${ REPO}`);
  console.log(`- Branch: ${ BRANCH}`);
  
  // Validasi konfigurasi
  if ( TOKEN === 'YOUR_ TOKEN_HERE' || 
       OWNER === 'YOUR_ USERNAME' || 
       REPO === 'YOUR_REPO_NAME') {
    console.log('\n⚠️  WARNING: Silakan isi konfigurasi GitHub di bagian atas file!');
    console.log('1.  TOKEN - Personal Access Token dari GitHub');
    console.log('2.  OWNER - Username GitHub Anda');
    console.log('3.  REPO - Nama repository untuk menyimpan file');
  } else {
    console.log('✅ GitHub configuration loaded successfully');
  }
});