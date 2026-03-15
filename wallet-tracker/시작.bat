@echo off
chcp 65001 > nul
echo 지갑 자산 트래커를 시작합니다...
echo.

:: Node.js 설치 확인
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo.
    echo https://nodejs.org 에서 LTS 버전을 다운로드하여 설치해주세요.
    echo 설치 후 이 파일을 다시 실행하세요.
    pause
    exit /b 1
)

:: .env.local 파일 확인
if not exist ".env.local" (
    echo [오류] .env.local 파일이 없습니다.
    echo .env.local.example 파일을 복사하여 .env.local 을 만들고
    echo MORALIS_API_KEY 를 입력해주세요.
    pause
    exit /b 1
)

:: 패키지 설치 (처음 한 번만)
if not exist "node_modules" (
    echo 필요한 패키지를 설치합니다. 잠시 기다려주세요...
    call npm install
    echo.
)

echo 서버를 시작합니다...
echo 브라우저에서 http://localhost:3000 으로 접속하세요.
echo.
echo 종료하려면 이 창을 닫으세요.
echo.
start http://localhost:3000
npm run dev
