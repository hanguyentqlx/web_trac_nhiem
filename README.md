# QuizLab — Web trắc nghiệm realtime

Web trắc nghiệm tối ưu cho điện thoại/iPhone, đọc bộ câu hỏi từ server và hỗ trợ phòng thi nhiều người bằng Socket.IO.

## Tính năng

- Giao diện mobile-first, tối ưu Safari trên iPhone.
- Random câu hỏi và thứ tự đáp án mỗi lượt.
- Chế độ một bộ đề, mỗi đề 1 câu, random toàn bộ.
- Đếm giờ / đếm ngược / không tính giờ khi luyện cá nhân.
- Kiểm tra đúng/sai theo từng câu khi luyện.
- Tạo phòng thi bằng mã 6 ký tự.
- Nhiều điện thoại/máy tính vào cùng phòng qua Socket.IO.
- Chủ phòng chọn bộ đề, số câu, thời gian và chế độ hiện đúng/sai ngay.
- Khi phòng thi không bật phản hồi tức thì, đáp án đúng không được gửi xuống client trước khi nộp.
- Server chấm điểm phòng thi và phát bảng xếp hạng realtime.
- Nhập thêm CSV từ giao diện; bộ đề mới được lưu vào `data/questions.json` trên server.

## Cấu trúc

```text
web_trac_nhiem/
├── server.js
├── package.json
├── .env.example
├── data/
│   ├── questions.json
│   └── source/
│       └── chu-nghia-xa-hoi-khoa-hoc-IV.csv
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── room-api.js
```

## Chạy local

Yêu cầu Node.js 18 trở lên.

```bash
npm install
npm start
```

Mở `http://localhost:3000`.

Để nhiều điện thoại cùng Wi-Fi truy cập, dùng IP LAN của máy chạy server, ví dụ `http://192.168.1.20:3000`.

## Bộ câu hỏi phía server

Dữ liệu mặc định nằm trong `data/questions.json`. Frontend không nhúng toàn bộ đáp án đúng. Server random đề và chấm điểm.

## Import CSV

CSV dùng các cột:

```text
STT,Câu Hỏi,Đáp Án Đúng,Đáp Án Sai 1,Đáp Án Sai 2,Đáp Án Sai 3
```

Khi bấm **Thêm CSV**, trình duyệt parse file rồi gửi dữ liệu lên `/api/datasets/import`. Server ghi bộ đề mới vào `data/questions.json`.

Có thể tắt ghi dữ liệu khi deploy public bằng `ALLOW_DATASET_UPLOAD=false`, hoặc đặt `ADMIN_KEY`.

## API chính

- `GET /api/health`
- `GET /api/datasets`
- `POST /api/datasets/import`
- `DELETE /api/datasets/:id`
- `POST /api/practice/start`
- `POST /api/practice/check`
- `POST /api/practice/finish`

Socket.IO: `room:create`, `room:join`, `room:get`, `room:start`, `room:check`, `room:submit`, `room:leave`.

## Deploy

Có thể deploy lên VPS, Railway, Render hoặc nền tảng Node.js tương tự. Lệnh chạy: `npm start`.

Phòng thi hiện lưu RAM; question bank lưu trong `data/questions.json`.
