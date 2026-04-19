# 비개발자용 사용법 (CSV 업로드 → MP4 다운로드)

## 1) 처음 한 번 설치
```bash
pip install pandas matplotlib streamlit
```

ffmpeg가 없다면 설치:
```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y ffmpeg
```

## 2) 웹 화면 실행
```bash
streamlit run crypto_video_app.py
```

## 3) 브라우저에서 사용
1. **CSV 업로드**
2. 필요 시 `Top N`, `FPS`, `DPI` 설정
3. **영상 생성** 버튼 클릭
4. 완료 후 **MP4 다운로드** 클릭

