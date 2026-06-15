@echo off
echo === Установка зависимостей сервера ===
cd server
call npm install
echo.
echo === Установка зависимостей клиента ===
cd ..\client
call npm install
echo.
echo === Запуск приложения ===
echo Сервер: http://localhost:3001
echo Клиент: http://localhost:5173
echo.
start "Messenger Server" cmd /k "cd ..\server && npm start"
timeout /t 2 /nobreak >nul
start "Messenger Client" cmd /k "npm run dev"
echo Готово! Откройте браузер: http://localhost:5173
