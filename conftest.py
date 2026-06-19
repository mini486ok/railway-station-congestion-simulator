"""pytest 루트 설정: 저장소 루트를 sys.path 에 추가해 ``import engine`` 가능하게 한다."""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
