# QuizLab — Web trắc nghiệm realtime

Web trắc nghiệm mobile-first, tối ưu Safari/iPhone, chạy bằng Node.js + Express + Socket.IO.

## Tính năng

- Random câu hỏi và thứ tự đáp án mỗi lượt.
- Luyện theo một bộ đề, mỗi bộ 1 câu hoặc random tổng hợp.
- Đếm lên / đếm ngược / không tính giờ.
- Chấm đúng/sai từng câu khi luyện.
- Tạo phòng thi mã 6 ký tự.
- Nhiều điện thoại/máy tính vào cùng phòng realtime.
- Chủ phòng chọn số câu, thời gian và có/không hiện đúng-sai ngay.
- Đáp án đúng của phòng thi được giữ ở server và server chấm điểm.
- Bảng xếp hạng phòng theo điểm và thời gian.
- Import thêm CSV từ giao diện; dữ liệu mới được ghi vào `data/questions.json`.

## Cấu trúc

```text
web_trac_nhiem/
├── server.js
├── package.json
├── .env.example
├── data/
│   ├── questions.json          # các bộ đề thêm từ giao diện
│   └── source/
│       ├── questions-01.csv    # 45 câu mặc định được chia 3 file nguồn
│       ├── questions-02.csv
│       └── questions-03.csv
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── room-api.js
```

Khi khởi động, server đọc tất cả file `.csv` trong `data/source/` và ghép thành bộ đề mặc định **Chủ nghĩa xã hội khoa học IV**. Các bộ đề import thêm được lưu server-side trong `data/questions.json`.

## Chạy local

Yêu cầu Node.js 18+.

```bash
npm install
npm start
```

Mở:

```text
http://localhost:3000
```

Để điện thoại cùng Wi-Fi vào phòng thi, dùng IP LAN của máy chạy Node, ví dụ:

```text
http://192.168.1.20:3000
```

## CSV

Các cột:

```text
STT,Câu Hỏi,Đáp Án Đúng,Đáp Án Sai 1,Đáp Án Sai 2,Đáp Án Sai 3
```

## API

- `GET /api/health`
- `GET /api/datasets`
- `POST /api/datasets/import`
- `DELETE /api/datasets/:id`
- `POST /api/practice/start`
- `POST /api/practice/check`
- `POST /api/practice/finish`

Socket.IO events:

- `room:create`
- `room:join`
- `room:get`
- `room:start`
- `room:check`
- `room:submit`
- `room:leave`
- server emit: `room:update`, `room:closed`

## Biến môi trường

Sao chép `.env.example` nếu cần cấu hình:

- `PORT`: cổng server, mặc định 3000.
- `HOST`: mặc định `0.0.0.0`.
- `ALLOW_DATASET_UPLOAD=false`: khóa import/xóa bộ đề.
- `ADMIN_KEY`: yêu cầu header `x-admin-key` khi ghi/xóa dữ liệu.

## Deploy

Có thể deploy lên VPS, Railway, Render hoặc dịch vụ Node.js hỗ trợ WebSocket.

Phòng thi đang lưu trong RAM nên sẽ mất khi restart server. Bộ câu hỏi nằm trên filesystem của server. Nếu deploy ở nền tảng filesystem tạm thời, nên gắn persistent disk hoặc chuyển question bank sang database.
