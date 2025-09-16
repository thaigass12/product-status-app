const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID; 
const QUERY_SHEET_NAME = 'Query_Results'; // *** ต้องเป็นชื่อชีทที่คุณสร้างไว้สำหรับ QUERY สูตร ***
const QUERY_INPUT_CELL = 'A2'; // เซลล์ที่ใช้รับค่าชื่อบัญชีเพื่อ Query
const QUERY_OUTPUT_RANGE = 'B1:I'; // ช่วงเซลล์ที่สูตร QUERY แสดงผลลัพธ์ (รวม Header)

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
    // กำหนดค่า CORS headers เพื่ออนุญาตการเข้าถึงจาก Origin ของคุณ
    res.setHeader('Access-Control-Allow-Origin', '*'); // ควรระบุ Origin ที่แน่นอนใน Production
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // จัดการ Preflight request สำหรับ CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are allowed.' });
    }

    const { accountName } = req.body;

    if (!accountName) {
        return res.status(400).json({ error: 'Missing Parameter', message: 'accountName is required.' });
    }

    try {
        const auth = new google.auth.JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // 1. เขียนชื่อบัญชีลงในเซลล์ที่ใช้ Query (A2 ของ Query_Results)
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${QUERY_SHEET_NAME}!${QUERY_INPUT_CELL}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[accountName.trim()]],
            },
        });

        // 2. อ่านผลลัพธ์จากช่วงเซลล์ที่สูตร QUERY แสดงผล (B1:I ของ Query_Results)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${QUERY_SHEET_NAME}!${QUERY_OUTPUT_RANGE}`,
        });

        const values = response.data.values || [];
        let foundItems = [];

        if (values.length > 1) { // มี Header และข้อมูล
            const headers = values[0];
            const headerMap = {};
            headers.forEach((header, index) => {
                headerMap[header.trim()] = index;
            });

            // ตรวจสอบ Headers ที่จำเป็น
            const missingHeaders = EXPECTED_HEADERS.filter(h => headerMap[h] === undefined);
            if (missingHeaders.length > 0) {
                console.warn(`Warning: Missing expected headers in sheet '${QUERY_SHEET_NAME}': ${missingHeaders.join(', ')}`);
                // คุณอาจจะเลือกที่จะจัดการ error ตรงนี้ หรือส่ง error กลับไป
            }

            for (let i = 1; i < values.length; i++) {
                const row = values[i];
                // ตรวจสอบว่า row มีข้อมูลเพียงพอตาม headers ที่คาดหวัง
                if (row.length > 0 && String(row[headerMap['ชื่อบัญชี']] || '').trim() !== '') { // ตรวจสอบว่ามีข้อมูลจริงในคอลัมน์ชื่อบัญชี
                    foundItems.push({
                        accountName: String(row[headerMap['ชื่อบัญชี']] || '').trim(),
                        imageUrl: String(row[headerMap['รูปสินค้า']] || '').trim(), 
                        productName: String(row[headerMap['ชื่อสินค้า']] || '').trim(),
                        // ใช้ parseFloat เพื่อแปลง string ที่ได้จาก Google Sheets เป็นตัวเลข
                        price: parseFloat(String(row[headerMap['ราคาสินค้า']] || '0').replace(/,/g, '')),
                        outstanding: parseFloat(String(row[headerMap['ค้างชำระ']] || '0').replace(/,/g, '')),
                        status: String(row[headerMap['สถานะ']] || '').trim(),
                        deliveryDueDate: String(row[headerMap['กำหนดส่งจากเว็ป']] || '').trim(),
                        remarks: String(row[headerMap['หมายเหตุ']] || '').trim()
                    });
                }
            }
        }

        if (foundItems.length > 0) {
            return res.status(200).json({ status: 'success', data: foundItems });
        } else {
            return res.status(404).json({ status: 'error', message: `ไม่พบ Account กรุณาตรวจสอบข้อมูลอีกครั้งหรือติดต่อทางร้าน` });
        }

    } catch (e) {
        console.error("Error in Serverless Function:", e);
        return res.status(500).json({ error: 'Internal Server Error', message: e.message || 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
};

