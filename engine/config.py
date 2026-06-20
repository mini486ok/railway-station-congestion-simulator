"""설정 스키마(dataclass) + JSON 직렬화/역직렬화 + 구조 검증.

Pyodide 호환을 위해 pydantic 등 네이티브 의존 없이 표준 라이브러리 dataclass 로만 구현한다.
프론트엔드(브라우저)는 config 를 dict(JSON) 로 전달하며, ``SimConfig.from_dict`` 로 읽는다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

ENGINE_VERSION = "0.1.0"
SCHEMA_VERSION = 1

# ── 노드 종류 (내부 식별자는 영문, 표시용 한글 라벨은 KIND_LABELS_KO) ──────────────
NODE_KINDS = [
    "entrance",   # 출입구
    "corridor",   # 통로
    "stairs",     # 계단
    "escalator",  # 에스컬레이터
    "elevator",   # 엘리베이터
    "gate",       # 게이트
    "platform",   # 승강장
]
KIND_LABELS_KO = {
    "entrance": "출입구",
    "corridor": "통로",
    "stairs": "계단",
    "escalator": "에스컬레이터",
    "elevator": "엘리베이터",
    "gate": "게이트",
    "platform": "승강장",
}
# 자체적으로 이용자를 생성(유입)하고, 시스템 밖으로 제거(유출)하는 노드 종류
SELF_GENERATING_KINDS = {"entrance", "platform"}
EGRESS_KINDS = {"entrance", "platform"}

# 노드 종류별 기본 자유보행속력(m/s) — 소요시간 자동 계산·밀도-속력 기본도에 사용
DEFAULT_V0 = {
    "entrance": 1.20,
    "corridor": 1.34,
    "stairs": 0.61,
    "escalator": 0.50,
    "elevator": 0.50,
    "gate": 1.00,
    "platform": 1.10,
}


# null/빈문자열 안전 파서 — 프론트 number input 을 비우면 null 이 올 수 있어 default 로 대체
def _f(d: Dict[str, Any], k: str, default: float) -> float:
    v = d.get(k, default)
    return float(default) if v in (None, "") else float(v)


def _i(d: Dict[str, Any], k: str, default: int) -> int:
    v = d.get(k, default)
    return int(default) if v in (None, "") else int(v)


# ── 수요 프로파일 (시간대별 배율) ─────────────────────────────────────────────────
@dataclass
class DemandProfile:
    """하루 시간대(0~24h)에 따른 수요 배율. 키포인트 선형보간(24h 주기 wrap-around)."""

    hours: List[float] = field(default_factory=list)        # 0..24 (정렬 권장)
    multipliers: List[float] = field(default_factory=list)  # 대응 배율(>=0)

    def to_dict(self) -> Dict[str, Any]:
        return {"hours": list(self.hours), "multipliers": list(self.multipliers)}

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> Optional["DemandProfile"]:
        if not d:
            return None
        return DemandProfile(
            hours=[float(x) for x in d.get("hours", [])],
            multipliers=[float(x) for x in d.get("multipliers", [])],
        )


# ── 자체발생(source) 사양 ─────────────────────────────────────────────────────────
@dataclass
class SourceSpec:
    """출입구/승강장의 자체 유입 발생 사양.

    type: ``none`` | ``poisson`` | ``normal`` | ``constant``
    rate: 스텝당 평균 유입 인원(λ 또는 μ). 프로파일이 있으면 시간대 배율이 곱해진다.
    sigma: ``normal`` 의 표준편차.
    """

    type: str = "none"
    rate: float = 0.0
    sigma: float = 0.0
    profile: Optional[DemandProfile] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "rate": self.rate,
            "sigma": self.sigma,
            "profile": self.profile.to_dict() if self.profile else None,
        }

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> Optional["SourceSpec"]:
        if not d:
            return None
        return SourceSpec(
            type=str(d.get("type", "none")),
            rate=_f(d, "rate", 0.0),
            sigma=_f(d, "sigma", 0.0),
            profile=DemandProfile.from_dict(d.get("profile")),
        )


# ── 열차 도착(승강장 전용) ────────────────────────────────────────────────────────
@dataclass
class TrainArrival:
    """승강장에 도착하는 한 대의 열차.

    하차(alight)는 t_arrival 시점의 버스트 유입(source), 탑승(board)은 정차창 동안
    대기승객을 TRAIN sink 로 보내는 우선 유출(열차 용량 상한).
    """

    t_arrival: int
    alight_mean: float = 0.0
    alight_sigma: float = 0.0
    alight_dist: str = "normal"   # normal | poisson | constant
    dwell_steps: int = 5
    train_capacity: float = 1000.0
    board_cap: float = 50.0       # 스텝당 최대 탑승 인원
    onboard_load: float = 0.0     # 도착 시 이미 탑승 중인 인원(재차) → 가용 좌석 = capacity - onboard_load
    delay_std: float = 0.0        # 도착 지연 변동(반-정규, 스텝). 0이면 정시.

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "TrainArrival":
        return TrainArrival(
            t_arrival=_i(d, "t_arrival", 0),
            alight_mean=_f(d, "alight_mean", 0.0),
            alight_sigma=_f(d, "alight_sigma", 0.0),
            alight_dist=str(d.get("alight_dist", "normal")),
            dwell_steps=_i(d, "dwell_steps", 5),
            train_capacity=_f(d, "train_capacity", 1000.0),
            board_cap=_f(d, "board_cap", 50.0),
            onboard_load=_f(d, "onboard_load", 0.0),
            delay_std=_f(d, "delay_std", 0.0),
        )


# ── 열차 운행 스케줄(첫 도착 + 배차간격) ──────────────────────────────────────────
@dataclass
class TrainSchedule:
    """승강장 열차를 '첫 도착 시점 + 배차간격'으로 정의하는 스케줄.

    개별 열차를 일일이 입력하는 대신, ``first_arrival`` 부터 ``headway`` 간격으로
    ``num_trains`` 대(0 이하면 시뮬 끝까지 자동)를 생성한다. 모든 열차는 동일한
    하차/탑승 파라미터를 공유한다. ``expand`` 로 ``TrainArrival`` 목록으로 펼친다.
    """

    first_arrival: int = 100      # 첫 열차 도착 스텝
    headway: int = 300            # 배차간격(스텝). <=0 이면 1대만.
    num_trains: int = 0           # 운행 대수. <=0 이면 시뮬 끝까지 자동.
    alight_mean: float = 0.0
    alight_sigma: float = 0.0
    alight_dist: str = "normal"
    dwell_steps: int = 30
    train_capacity: float = 800.0
    board_cap: float = 25.0
    onboard_load: float = 0.0
    delay_std: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> Optional["TrainSchedule"]:
        if not d:
            return None
        return TrainSchedule(
            first_arrival=_i(d, "first_arrival", 100),
            headway=_i(d, "headway", 300),
            num_trains=_i(d, "num_trains", 0),
            alight_mean=_f(d, "alight_mean", 0.0),
            alight_sigma=_f(d, "alight_sigma", 0.0),
            alight_dist=str(d.get("alight_dist", "normal")),
            dwell_steps=_i(d, "dwell_steps", 30),
            train_capacity=_f(d, "train_capacity", 800.0),
            board_cap=_f(d, "board_cap", 25.0),
            onboard_load=_f(d, "onboard_load", 0.0),
            delay_std=_f(d, "delay_std", 0.0),
        )

    def expand(self, total_steps: int) -> List["TrainArrival"]:
        """[first_arrival, +headway, ...] 도착 시각으로 TrainArrival 목록 생성."""
        out: List[TrainArrival] = []
        fa = max(0, int(self.first_arrival))
        hw = int(self.headway)
        if hw <= 0:
            count = 1
        elif self.num_trains and int(self.num_trains) > 0:
            count = int(self.num_trains)
        else:
            count = max(0, (int(total_steps) - fa) // hw + 1)
        t = fa
        for _ in range(count):
            if t > int(total_steps):     # 시뮬 범위 밖 도착은 효과 없음
                break
            out.append(TrainArrival(
                t_arrival=t,
                alight_mean=self.alight_mean,
                alight_sigma=self.alight_sigma,
                alight_dist=self.alight_dist,
                dwell_steps=self.dwell_steps,
                train_capacity=self.train_capacity,
                board_cap=self.board_cap,
                onboard_load=self.onboard_load,
                delay_std=self.delay_std,
            ))
            if hw <= 0:
                break
            t += hw
        return out


# ── 노드 ──────────────────────────────────────────────────────────────────────────
@dataclass
class NodeConfig:
    id: str
    name: str = ""
    kind: str = "corridor"
    direction: str = ""           # 양방향 모델링 방향 라벨(예: 입구/출구, 상행/하행, 진입/진출). 동역학엔 영향 없음, 메타/UI/export 용.
    area: float = 10.0            # m^2 (혼잡도 = N/area, 동적 체류확률에 사용)
    p_stay_base: float = 0.5      # 기본 체류 확률 (P_move_base = 1 - p_stay_base)
    dynamic_pstay: bool = True    # 혼잡도에 따른 동적 체류확률 사용 여부
    v0: Optional[float] = None    # 자유보행속력(m/s). None 이면 종류별 기본값.
    n0: float = 0.0               # 초기 인원
    source: Optional[SourceSpec] = None      # 출입구/승강장 유입 생성
    trains: List[TrainArrival] = field(default_factory=list)  # (레거시) 개별 열차 목록
    train_schedule: Optional["TrainSchedule"] = None  # 첫 도착+배차간격 스케줄(우선)
    platform_role: str = "both"   # 승강장 역할: both | alight(하차=유입) | board(승차=유출)
    exit_weight: float = 0.0      # 출입구 -> OUTSIDE 퇴장 비율(출력 가중치의 일부)
    throughput_cap: float = 0.0   # 게이트 등 스텝당 통과(유출) 상한. 0이면 무제한.
    group: str = ""               # 물리적 동일 장소 그룹(예: 입구/출구를 한 출입구로 합산). 빈값이면 자신만.
    elevator_capacity: float = 0.0  # 엘리베이터 1회 운행 수송 인원. 0이면 무제한.
    elevator_cycle: int = 0       # 엘리베이터 운행 주기(스텝). >=1 이면 엘리베이터 배치 거동 활성.
    x: float = 0.0                # 에디터 좌표(거리 자동 계산 보조)
    y: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "direction": self.direction,
            "area": self.area,
            "p_stay_base": self.p_stay_base,
            "dynamic_pstay": self.dynamic_pstay,
            "v0": self.v0,
            "n0": self.n0,
            "source": self.source.to_dict() if self.source else None,
            "trains": [t.to_dict() for t in self.trains],
            "train_schedule": self.train_schedule.to_dict() if self.train_schedule else None,
            "platform_role": self.platform_role,
            "exit_weight": self.exit_weight,
            "throughput_cap": self.throughput_cap,
            "group": self.group,
            "elevator_capacity": self.elevator_capacity,
            "elevator_cycle": self.elevator_cycle,
            "x": self.x,
            "y": self.y,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "NodeConfig":
        return NodeConfig(
            id=str(d["id"]),
            name=str(d.get("name", "")),
            kind=str(d.get("kind", "corridor")),
            direction=str(d.get("direction", "") or ""),
            area=_f(d, "area", 10.0),
            p_stay_base=_f(d, "p_stay_base", 0.5),
            dynamic_pstay=bool(d.get("dynamic_pstay", True)),
            v0=(None if d.get("v0") in (None, "") else float(d["v0"])),
            n0=_f(d, "n0", 0.0),
            source=SourceSpec.from_dict(d.get("source")),
            trains=[TrainArrival.from_dict(t) for t in d.get("trains", [])],
            train_schedule=TrainSchedule.from_dict(d.get("train_schedule")),
            platform_role=str(d.get("platform_role", "both") or "both"),
            exit_weight=_f(d, "exit_weight", 0.0),
            throughput_cap=_f(d, "throughput_cap", 0.0),
            group=str(d.get("group", "") or ""),
            elevator_capacity=_f(d, "elevator_capacity", 0.0),
            elevator_cycle=_i(d, "elevator_cycle", 0),
            x=_f(d, "x", 0.0),
            y=_f(d, "y", 0.0),
        )

    def resolved_v0(self) -> float:
        if self.v0 is not None:
            return self.v0
        return DEFAULT_V0.get(self.kind, 1.34)


# ── 링크 ──────────────────────────────────────────────────────────────────────────
@dataclass
class LinkConfig:
    src: str
    dst: str
    distance: float = 10.0        # m
    weight: float = 1.0           # 동일 src 출력 링크 가중치 합 = 1
    tau: Optional[int] = None     # 이산 스텝 소요시간. None 이면 거리/속력/Δ로 자동 계산.

    def to_dict(self) -> Dict[str, Any]:
        return {
            "src": self.src,
            "dst": self.dst,
            "distance": self.distance,
            "weight": self.weight,
            "tau": self.tau,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "LinkConfig":
        return LinkConfig(
            src=str(d["src"]),
            dst=str(d["dst"]),
            distance=_f(d, "distance", 10.0),
            weight=_f(d, "weight", 1.0),
            tau=(None if d.get("tau") in (None, "") else int(d["tau"])),
        )


# ── 동역학(밀도-속력, 용량) 설정 ─────────────────────────────────────────────────
@dataclass
class DynamicsConfig:
    v0_default: float = 1.34      # 기본 자유보행속력(m/s)
    rho_max: float = 5.4          # 최대 밀도(인/m^2) — Weidmann
    gamma: float = 1.913          # Weidmann 형상 계수
    p_stay_cap: float = 0.98      # 동적 체류확률 상한
    lpf_alpha: float = 0.3        # 1차 저역통과: P_stay <- a*old + (1-a)*target
    capacity_enabled: bool = False
    spillback_enabled: bool = False
    rho_cap: float = 5.0          # 노드 최대 수용 밀도(인/m^2)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> "DynamicsConfig":
        d = d or {}
        return DynamicsConfig(
            v0_default=_f(d, "v0_default", 1.34),
            rho_max=_f(d, "rho_max", 5.4),
            gamma=_f(d, "gamma", 1.913),
            p_stay_cap=_f(d, "p_stay_cap", 0.98),
            lpf_alpha=_f(d, "lpf_alpha", 0.3),
            capacity_enabled=bool(d.get("capacity_enabled", False)),
            spillback_enabled=bool(d.get("spillback_enabled", False)),
            rho_cap=_f(d, "rho_cap", 5.0),
        )


# ── Export 설정 ───────────────────────────────────────────────────────────────────
@dataclass
class ExportConfig:
    aggregate_steps: int = 1            # 1=원해상도, N=N스텝 집계 다운샘플
    aggregate_method: str = "mean"      # mean | snapshot (혼잡도). 유입/유출은 항상 합산.
    output_level: str = "group"         # group(물리 그룹 단위 집계) | node(노드 단위). 그룹 미정의면 동일.
    noise_enabled: bool = False
    noise_model: str = "gaussian"       # gaussian | poisson
    noise_sigma: float = 0.0            # gaussian 표준편차(인원)
    feature_channels: List[str] = field(
        default_factory=lambda: ["count"]
    )  # count, density, inflow, outflow, p_stay 등

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> "ExportConfig":
        d = d or {}
        # 누락/빈 값만 기본값으로 대체하고, 잘못된 값은 보존해 validate 가 잡도록 한다.
        lvl = d.get("output_level", "group")
        lvl = "group" if lvl in (None, "") else str(lvl)
        return ExportConfig(
            aggregate_steps=_i(d, "aggregate_steps", 1),
            aggregate_method=str(d.get("aggregate_method", "mean")),
            output_level=lvl,
            noise_enabled=bool(d.get("noise_enabled", False)),
            noise_model=str(d.get("noise_model", "gaussian")),
            noise_sigma=_f(d, "noise_sigma", 0.0),
            feature_channels=list(d.get("feature_channels", ["count"])),
        )


# ── 수요 다양성(STGCN 학습신호 강화) ────────────────────────────────────────────
@dataclass
class DemandConfig:
    """전역 수요 변동 — 노드 간 공간 상관과 일간 변동을 주입해 STGCN 학습 가치를 높임."""

    day_variability_sigma: float = 0.0   # 런(시드)별 일간 배율 LogNormal(0,σ). 0=동일.
    common_factor_phi: float = 0.0       # 전역 공통요인 AR(1) 계수(0~1). 공간 상관 강도.
    common_factor_sigma: float = 0.0     # 공통요인 AR(1) 노이즈 표준편차. 0=공통요인 없음.

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Optional[Dict[str, Any]]) -> "DemandConfig":
        d = d or {}
        return DemandConfig(
            day_variability_sigma=_f(d, "day_variability_sigma", 0.0),
            common_factor_phi=_f(d, "common_factor_phi", 0.0),
            common_factor_sigma=_f(d, "common_factor_sigma", 0.0),
        )


# ── 최상위 시뮬레이션 설정 ────────────────────────────────────────────────────────
@dataclass
class SimConfig:
    nodes: List[NodeConfig] = field(default_factory=list)
    links: List[LinkConfig] = field(default_factory=list)
    dt_seconds: float = 1.0       # 스텝당 실초
    total_steps: int = 3600
    start_time_sec: float = 0.0   # 자정 기준 시작 시각(초) — 시간대 프로파일에 사용
    seed: int = 0
    integer_mode: bool = False    # True 면 유출 단계 multinomial 정수 분배
    warmup_steps: int = 0         # export 시 제외할 워밍업 스텝 수
    dynamics: DynamicsConfig = field(default_factory=DynamicsConfig)
    export: ExportConfig = field(default_factory=ExportConfig)
    demand: DemandConfig = field(default_factory=DemandConfig)
    name: str = "station"
    schema_version: int = SCHEMA_VERSION
    engine_version: str = ENGINE_VERSION

    # ── 직렬화 ──
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "schema_version": self.schema_version,
            "engine_version": self.engine_version,
            "dt_seconds": self.dt_seconds,
            "total_steps": self.total_steps,
            "start_time_sec": self.start_time_sec,
            "seed": self.seed,
            "integer_mode": self.integer_mode,
            "warmup_steps": self.warmup_steps,
            "dynamics": self.dynamics.to_dict(),
            "export": self.export.to_dict(),
            "demand": self.demand.to_dict(),
            "nodes": [n.to_dict() for n in self.nodes],
            "links": [l.to_dict() for l in self.links],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "SimConfig":
        return SimConfig(
            name=str(d.get("name", "station")),
            schema_version=_i(d, "schema_version", SCHEMA_VERSION),
            engine_version=str(d.get("engine_version", ENGINE_VERSION)),
            dt_seconds=_f(d, "dt_seconds", 1.0),
            total_steps=_i(d, "total_steps", 3600),
            start_time_sec=_f(d, "start_time_sec", 0.0),
            seed=_i(d, "seed", 0),
            integer_mode=bool(d.get("integer_mode", False)),
            warmup_steps=_i(d, "warmup_steps", 0),
            dynamics=DynamicsConfig.from_dict(d.get("dynamics")),
            export=ExportConfig.from_dict(d.get("export")),
            demand=DemandConfig.from_dict(d.get("demand")),
            nodes=[NodeConfig.from_dict(n) for n in d.get("nodes", [])],
            links=[LinkConfig.from_dict(l) for l in d.get("links", [])],
        )

    @staticmethod
    def from_json(s: str) -> "SimConfig":
        return SimConfig.from_dict(json.loads(s))
