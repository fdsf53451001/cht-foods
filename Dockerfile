# 使用 nginx 作為靜態網站伺服器
FROM nginx:alpine

# 複製靜態檔案到 nginx 的預設目錄
COPY index.html /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/

# 複製 nginx 設定檔
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run 使用 PORT 環境變數
EXPOSE 8080

# 啟動 nginx
CMD ["nginx", "-g", "daemon off;"]
