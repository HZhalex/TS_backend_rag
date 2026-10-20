# PROGRESS — backend RAG_TS

| Prompt | Trạng thái | Test | Ghi chú |
| :-- | :-- | :-- | :-- |
| B1 Bootstrap & Common | Xong | 22 unit + 2 e2e pass | Thiếu env ➔ exit 1 liệt kê đủ biến; 404 đúng §1.2 + `X-Request-Id`; 1 dòng log JSON/request, không chứa Authorization |
| B2 Auth | Xong | 18 integration (mongodb-memory-server) | 7 route; xoay vòng refresh, dùng lại ➔ thu hồi cả họ; 2 refresh đồng thời chỉ 1 thành công; 5 lần sai ➔ 429; log `LOGIN_FAILED` chỉ có `email_hash` |
| B3 Embedding | Xong | 8 unit | Chạy thật: 768 chiều, norm 1.0, 43 ms/câu; khớp vector Python của pipeline (cosine 0.99999999999) |
| B4 Qdrant (chỉ đọc) | Xong | 15 unit | Qdrant thật: câu LoRA ➔ top 1 là 2106.09685 (0.8275); lọc `cs.CL` đúng; `scrollByPaper` 18 chunk; payload chưa có `twig_id` |
| B5 Mining & Tree Router | Xong (thiếu dữ liệu world) | 26 unit | Dữ liệu mining thật: 120 tác giả, 7 luật chữ; "Liu" không khớp "Yang Liu". Chưa kiểm được `node_id` với `tree.json` vì pipeline chưa xuất file world (Phụ lục B P1) — route trả `steps: []` |
| B6 LLM Queue | Xong | 11 unit | Model thật (Metal): nạp 4,6 s; 10 request cùng lúc với LLM_MAX_QUEUE=8 ➔ 1 chạy + 8 chờ + 1 nhận 429; abort ➔ queue_length về 0 |
| B7 RAG & SSE | Xong | 20 integration | Chạy thật: thứ tự event đúng; câu LoRA có citation + LaTeX, 520 token / 42 s (Metal); huỷ stream ➔ log `CHAT_STREAM_ABORTED`, không lưu; slot LLM giải phóng ~15 s sau (đang đọc prompt). Chưa chạy được bước FE `VITE_USE_MOCK=false` (cần FE đổi base URL + health) |
| B8 Chat sessions | Xong | 11 integration | Thật: hỏi 2 câu cùng session có JWT ➔ `message_count` = 4; phân trang 3 trang không trùng/sót (cả khi trùng `updated_at`) |
| B9 Papers | Xong | 7 integration | Thật: `2106.09685` ➔ 18 chunk, abstract đầu, year 2021; `s2_…` ➔ 181 chunk. `category_index` = -1 vì chưa có `categories.json` |
| B10 Health | Xong | 7 unit | Thật (Qdrant qua proxy bị tắt): `/health/ready` 503 + `HEALTH_CHANGED` up➔down; bật lại ➔ 200 + down➔up |
| B11 E2E, Docker, OpenAPI, README | Xong | 6 e2e (Qdrant in-memory và Qdrant thật) | `/api/v1/docs-json` đủ 18 route; `seed-qdrant` từ chối `scientific_papers_gold`; `docker compose up` ➔ app healthy, `/health` degraded khi không có model |

**Tổng:** 146 unit/integration + 6 e2e pass; `tsc --noEmit` và `eslint` sạch.

## Vấn đề tồn tại

1. Pipeline chưa xuất file world (`tree.json`, `centroids_l1/l2.json`, `categories.json`) và payload `twig_id`, `chunk_index` (Phụ lục B P1–P3): event `route` rỗng, `compare` không lọc theo nhánh, `category_index` = -1.
2. FE chưa đổi `VITE_API_BASE=/api/v1` và cách đọc health (Phụ lục A1, A5) — chưa chạy được bước kiểm chứng B7 với FE thật.
3. Huỷ stream khi LLM đang đọc prompt: slot giải phóng chậm (~15 s với top_k 5).
4. Qwen 7B không chạy được trong Docker trên Mac 8 GB (CPU, hết RAM) — dev nên chạy app ngoài Docker.
5. Luật FP-Growth thật chỉ có 7/41 luật dạng chữ, vài tag bị cắt (`attention-mech`) ➔ mở rộng query ít khi kích hoạt.
