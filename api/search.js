// api/search.js

const { google } = require('googleapis');


const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;1THeQ3kv4FbgMBDwrfwX5aIfNDieMEsGIdaHKKQ6ywu8; 
const QUERY_SHEET_NAME = 'Query_Results'; 
const QUERY_INPUT_CELL = 'A2'; // เซลล์ใน QUERY_SHEET_NAME ที่จะใส่ชื่อบัญชี (ต้องตรงกับที่คุณตั้งใน GSheet)
const QUERY_OUTPUT_RANGE = 'B1:I'; // ช่วงข้อมูลที่คาดว่าจะได้จาก QUERY (A1 ถึงคอลัมน์สุดท้ายของข้อมูล)

// Headers ที่คาดหวังจาก Google Sheet (ต้องตรงเป๊ะกับ Headers ในชีทหลักของคุณ)
const EXPECTED_HEADERS = [
    'ชื่อบัญชี', 'รูปสินค้า', 'ชื่อสินค้า', 'ราคาสินค้า', 
    'ค้างชำระ', 'สถานะ', 'กำหนดส่งจากเว็ป', 'หมายเหตุ'
]; 

// ตรวจสอบว่า Credentials ถูกตั้งค่าครบถ้วน
if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !SPREADSHEET_ID) {
    console.error('Environment variables for Google Sheets API are not fully set.');
    // สำหรับ Production ควร return error ไปยัง Frontend ด้วย
}

module.exports = async (req, res) => {
    // กำหนด Headers สำหรับ CORS (Cross-Origin Resource Sharing)
    // เพื่อให้ Frontend สามารถเรียก API นี้ได้
    res.setHeader('Access-Control-Allow-Origin', '*'); // อนุญาตทุกโดเมน (สำหรับการทดสอบ)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // ถ้าเป็น OPTIONS request (Preflight request) ให้ตอบกลับทันที
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are supported.' });
    }

    const { accountName } = req.body;

    if (!accountName) {
        return res.status(400).json({ error: 'Missing Parameter', message: 'accountName is required.' });
    }

    try {
        // 1. สร้าง JWT client สำหรับ Service Account
        const auth = new google.auth.JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // เปลี่ยน \\n ให้เป็น Newline จริงๆ
            scopes: ['https://www.googleapis.com/auth/spreadsheets'], // สิทธิ์ในการเข้าถึง Google Sheets
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // 2. เขียนชื่อบัญชีลงในเซลล์ที่ Query Sheet เพื่อให้สูตรกรองข้อมูล
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${QUERY_SHEET_NAME}!${QUERY_INPUT_CELL}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[accountName.trim()]],
            },
        });

        // ให้เวลา Google Sheet ประมวลผลสูตร (อาจจะไม่จำเป็นเสมอไป แต่ช่วยเพิ่มความเสถียร)
        // await new Promise(resolve => setTimeout(resolve, 500)); 

        // 3. อ่านข้อมูลที่ถูกกรองแล้วจาก Query Sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${QUERY_SHEET_NAME}!${QUERY_OUTPUT_RANGE}`,
        });

        const values = response.data.values || [];
        const foundItems = [];

        // ตรวจสอบว่ามีข้อมูลหรือไม่ (แถวแรกคือ Header จาก QUERY)
        // ตรวจสอบเงื่อนไขว่าถ้ามีแค่ Header หรือ Header + แถวว่างเปล่า
        if (values.length < 2 || (values.length >= 2 && String(values[1][0] || '').trim() === '')) {
            return res.status(404).json({ status: 'error', message: `ไม่พบข้อมูลสำหรับชื่อบัญชี '${accountName}'` });
        }

        // สร้าง Header Map เพื่อให้เข้าถึงข้อมูลแต่ละคอลัมน์ได้ง่ายขึ้น
        const headers = values[0];
        const headerMap = {};
        headers.forEach((header, index) => {
          headerMap[header.trim()] = index;
        });

        // ตรวจสอบว่า Headers ที่จำเป็นครบหรือไม่
        const missingHeaders = EXPECTED_HEADERS.filter(h => headerMap[h] === undefined);
        if (missingHeaders.length > 0) {
            return res.status(500).json({ status: 'error', message: `โครงสร้างคอลัมน์ในชีท '${QUERY_SHEET_NAME}' ไม่ถูกต้อง: คอลัมน์ที่ขาดไปคือ ${missingHeaders.join(', ')}` });
        }
        
        // วนลูปอ่านข้อมูลจากแถวที่ 2 เป็นต้นไป (ข้าม Header: เริ่มจาก i = 1)
        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            // ตรวจสอบว่าแถวนั้นมีข้อมูลจริงหรือไม่
            if (String(row[headerMap['ชื่อบัญชี']] || '').trim() === '') {
                break; // ถ้าคอลัมน์ 'ชื่อบัญชี' ว่างเปล่า แสดงว่าหมดข้อมูลแล้ว
            }

            // เพิ่มข้อมูลที่พบลงใน Array
            foundItems.push({
                accountName: String(row[headerMap['ชื่อบัญชี']] || '').trim(),
                imageUrl: String(row[headerMap['รูปสินค้า']] || '').trim(), 
                productName: String(row[headerMap['ชื่อสินค้า']] || '').trim(),
                price: String(row[headerMap['ราคาสินค้า']] || '').trim(),
                outstanding: String(row[headerMap['ค้างชำระ']] || '').trim(), 
                status: String(row[headerMap['สถานะ']] || '').trim(),
                deliveryDueDate: String(row[headerMap['กำหนดส่งจากเว็ป']] || '').trim(),
                remarks: String(row[headerMap['หมายเหตุ']] || '').trim()
            });
        }

        if (foundItems.length > 0) {
            return res.status(200).json({ status: 'success', data: foundItems });
        } else {
            return res.status(404).json({ status: 'error', message: `ไม่พบข้อมูลสำหรับชื่อบัญชี '${accountName}'` });
        }

    } catch (e) {
        console.error("Error in Serverless Function:", e);
        return res.status(500).json({ error: 'Internal Server Error', message: e.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
};
