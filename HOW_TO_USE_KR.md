# 비개발자용 사용법 (CSV 업로드 → MP4 다운로드)

## 1) 처음 한 번 설치

### Windows (중요)
`pip` 명령이 안 먹는 경우가 많아서, 아래처럼 **`py -m pip`** 로 설치하세요.
```bash
py -m pip install --upgrade pip
py -m pip install pandas matplotlib streamlit
```

만약 `py`도 안 되면:
```bash
python -m pip install --upgrade pip
python -m pip install pandas matplotlib streamlit
```

### Mac / Linux
```bash
python3 -m pip install --upgrade pip
python3 -m pip install pandas matplotlib streamlit
```

ffmpeg가 없다면 설치:
```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y ffmpeg
```

## 2) 웹 화면 실행

### Windows
```bash
py -m streamlit run crypto_video_app.py
```

### Mac / Linux
```bash
python3 -m streamlit run crypto_video_app.py
```

## 3) 브라우저에서 사용
1. **CSV 업로드**
2. 필요 시 `Top N`, `FPS`, `DPI` 설정
3. **영상 생성** 버튼 클릭
4. 완료 후 **MP4 다운로드** 클릭

## 4) 오류가 날 때 (Windows)

### `'pip'은(는) 내부 또는 외부 명령...` 오류
- `pip ...` 대신 아래 명령 사용:
```bash
py -m pip install pandas matplotlib streamlit
```

### `'py'도 인식 안 됨` 오류
- Python 설치 시 **Add Python to PATH** 체크 후 다시 설치하거나,
- 아래 명령 시도:
```bash
python -m pip install pandas matplotlib streamlit
python -m streamlit run crypto_video_app.py
```
