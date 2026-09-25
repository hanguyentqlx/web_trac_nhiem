# Kiến trúc QuizLab server

## Mục tiêu

- Question bank là dữ liệu server-side.
- Phòng thi dùng chung một đề do server tạo.
- Client phòng thi không nhận `correct` trước khi nộp.
- Server là nguồn sự thật cho điểm và thời gian hoàn thành phòng thi.

## Dữ liệu

`data/questions.json` được đọc khi server khởi động. Import CSV qua API sẽ cập nhật file này bằng thao tác ghi file tạm rồi rename.

## Luyện cá nhân

`POST /api/practice/start` tạo một practice session trong RAM và trả quiz đã loại trường `correct`.

Khi người dùng bấm kiểm tra đáp án, frontend gọi `POST /api/practice/check`. Khi kết thúc, `POST /api/practice/finish` chấm lại toàn bộ lựa chọn và trả review.

## Phòng thi

Server giữ `rooms` trong `Map`:

- mã phòng
- host
- config
- danh sách thành viên
- quiz nội bộ có đáp án đúng
- trạng thái và kết quả

`publicRoom()` loại đáp án đúng trước khi phát qua Socket.IO.

Nếu bật `instantFeedback`, event `room:check` chỉ trả đáp án đúng của câu đang kiểm tra. Nếu tắt, event này bị server từ chối và đáp án chỉ được trả sau `room:submit`.

## Persistence

- Question bank: persistent file `data/questions.json`.
- Room/practice sessions: RAM, tự dọn theo TTL.

Nếu cần production lớn hơn, thay `Map` bằng Redis và `questions.json` bằng PostgreSQL/MySQL mà không cần thay giao diện frontend.
