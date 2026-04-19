#!/usr/bin/env python3
"""Non-developer friendly web UI: upload CSV -> download MP4."""

from __future__ import annotations

import tempfile
from pathlib import Path

import streamlit as st

from create_crypto_top20_video import generate_video_from_csv


st.set_page_config(page_title="Crypto Top20 Video Maker", page_icon="🎬", layout="centered")
st.title("🎬 크립토 연도별 Top-20 영상 만들기")
st.write("CSV 파일을 업로드하면 MP4 영상을 자동으로 생성합니다.")

uploaded_file = st.file_uploader("CSV 업로드", type=["csv"])
col1, col2, col3 = st.columns(3)
with col1:
    top_n = st.number_input("Top N", min_value=5, max_value=50, value=20, step=1)
with col2:
    fps = st.number_input("FPS", min_value=1, max_value=10, value=1, step=1)
with col3:
    dpi = st.number_input("DPI", min_value=100, max_value=300, value=160, step=10)

if uploaded_file is not None:
    if st.button("영상 생성", type="primary"):
        try:
            with tempfile.TemporaryDirectory() as td:
                workdir = Path(td)
                input_csv = workdir / "input.csv"
                output_mp4 = workdir / "crypto_top20_by_year.mp4"

                input_csv.write_bytes(uploaded_file.getvalue())

                with st.spinner("영상 생성 중입니다... (데이터 크기에 따라 시간이 걸릴 수 있습니다)"):
                    final_path = generate_video_from_csv(
                        input_path=input_csv,
                        output_path=output_mp4,
                        fps=int(fps),
                        dpi=int(dpi),
                        top_n=int(top_n),
                    )

                video_bytes = final_path.read_bytes()

            st.success("완료! 아래 버튼으로 MP4를 다운로드하세요.")
            st.download_button(
                label="MP4 다운로드",
                data=video_bytes,
                file_name="crypto_top20_by_year.mp4",
                mime="video/mp4",
            )
        except Exception as e:
            st.error(
                "영상 생성에 실패했습니다.\n"
                f"오류: {e}\n\n"
                "필수 패키지 확인:\n"
                "- Windows: py -m pip install pandas matplotlib streamlit\n"
                "- Mac/Linux: python3 -m pip install pandas matplotlib streamlit\n"
                "또는 ffmpeg 설치 상태를 확인해 주세요."
            )
else:
    st.info("먼저 CSV 파일을 업로드해 주세요.")

st.caption("실행 방법: streamlit run crypto_video_app.py")
