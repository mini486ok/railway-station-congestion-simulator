"""철도역사 혼잡도 시뮬레이션 엔진 (순수 Python + numpy, Pyodide 호환).

핵심 모듈:
    config     : dataclass 설정 트리 + JSON 직렬화/검증
    model      : 설정 -> SoA(numpy) 자료구조, sink 합성, 링크 CSR
    generators : 자체발생(Poisson/Normal/Constant + 시간대 프로파일), 열차 스케줄
    dynamics   : Weidmann 밀도-속력 기본도 -> 동적 체류확률, 용량/게이트
    rounding   : 확률적 반올림(정수 모드)
    simulator  : 이산 시간 메인 루프(보존 정합식 + 유출 sink)
    recorder   : [T, N, F] 적재 + CSV/npz export, 집계/노이즈
    validate   : 런타임 불변식·보존 모니터
"""

from .config import (
    SimConfig,
    NodeConfig,
    LinkConfig,
    SourceSpec,
    TrainArrival,
    DemandProfile,
    DynamicsConfig,
    ExportConfig,
    NODE_KINDS,
    KIND_LABELS_KO,
    ENGINE_VERSION,
    SCHEMA_VERSION,
)
from .model import Model, build_model
from .simulator import Simulator, run
from .recorder import Recorder

__all__ = [
    "SimConfig",
    "NodeConfig",
    "LinkConfig",
    "SourceSpec",
    "TrainArrival",
    "DemandProfile",
    "DynamicsConfig",
    "ExportConfig",
    "NODE_KINDS",
    "KIND_LABELS_KO",
    "ENGINE_VERSION",
    "SCHEMA_VERSION",
    "Model",
    "build_model",
    "Simulator",
    "run",
    "Recorder",
]

ENGINE_VERSION_TUPLE = (0, 1, 0)
