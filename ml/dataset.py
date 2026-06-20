"""시뮬레이터가 생성한 X.npz 를 STGCN 학습용 텐서로 변환.

- 단일 run: 시간축 슬라이딩 윈도우 + 시간축 train/val/test 분할.
- 다중 run: 여러 시나리오(시드) 파일을 읽어 **run 단위 홀드아웃**으로 분할(일반화 평가에 더 적합).
- 외생 특징: 하루 시각 sin/cos 2채널을 추가(주기성 학습 보조).
- 인접행렬: 방향 보존 정규화(forward) + 역방향(backward) 둘 다 제공.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence

import numpy as np


def load_npz(path: str):
    d = np.load(path, allow_pickle=True)
    X = d["X"].astype(np.float32)               # [T, N, F]
    channels = [str(c) for c in d["channels"]]
    A = d["adjacency"].astype(np.float32)       # [N, N]
    node_ids = [str(x) for x in d["node_ids"]]
    dt = float(d["dt_seconds"]) if "dt_seconds" in d.files else 1.0
    start = float(d["start_time_sec"]) if "start_time_sec" in d.files else 0.0
    step_index = (d["step_index"].astype(np.int64) if "step_index" in d.files
                  else np.arange(X.shape[0], dtype=np.int64))
    return X, channels, A, node_ids, dt, start, step_index


def _read_schema(path):
    """다중 run 일관성 검증용 메타(출력 단위·채널·노드 식별자)."""
    d = np.load(path, allow_pickle=True)
    vs = str(d["value_scale"]) if "value_scale" in d.files else "node"
    return vs, [str(c) for c in d["channels"]], [str(x) for x in d["node_ids"]]


def normalized_adjacency(A: np.ndarray, directional: bool = True) -> np.ndarray:
    """전파용 정규화 인접행렬.

    directional=True(기본): D_out^-1 (A+I) 로 **방향성 보존**.
    directional=False: 대칭 정규화 Â = D^-1/2 (Ã+I) D^-1/2.
    """
    A = np.asarray(A, dtype=np.float32).copy()
    N = A.shape[0]
    if directional:
        A = A + np.eye(N, dtype=np.float32)
        deg = A.sum(axis=1)
        dinv = 1.0 / np.maximum(deg, 1e-8)
        return (dinv[:, None] * A).astype(np.float32)
    As = A + A.T
    np.fill_diagonal(As, 0.0)
    As = As + np.eye(N, dtype=np.float32)
    deg = As.sum(axis=1)
    dinv = 1.0 / np.sqrt(np.maximum(deg, 1e-8))
    return (dinv[:, None] * As * dinv[None, :]).astype(np.float32)


def time_features(step_index: np.ndarray, dt: float, start: float, N: int):
    """하루 시각(0~24h) sin/cos 를 [T, N, 1] 로 broadcast (주기성 외생 특징)."""
    sec = start + step_index.astype(np.float64) * dt
    frac = (sec % 86400.0) / 86400.0
    s = np.sin(2 * np.pi * frac).astype(np.float32)
    c = np.cos(2 * np.pi * frac).astype(np.float32)
    s = np.repeat(s[:, None], N, axis=1)[:, :, None]
    c = np.repeat(c[:, None], N, axis=1)[:, :, None]
    return s, c


@dataclass
class Dataset:
    xtr: np.ndarray
    ytr: np.ndarray
    xva: np.ndarray
    yva: np.ndarray
    xte: np.ndarray
    yte: np.ndarray
    A_hat: np.ndarray      # forward
    A_hat_bwd: np.ndarray  # backward
    target_mean: np.ndarray
    target_std: np.ndarray
    channels: List[str]
    node_ids: List[str]
    target_idx: int


def _windows(X: np.ndarray, P: int, Q: int, target_idx: int):
    T = X.shape[0]
    xs, ys = [], []
    for t in range(0, T - P - Q + 1):
        xs.append(X[t: t + P])
        ys.append(X[t + P: t + P + Q, :, target_idx])
    if not xs:
        return (np.zeros((0, P, X.shape[1], X.shape[2]), np.float32),
                np.zeros((0, Q, X.shape[1]), np.float32))
    return np.stack(xs).astype(np.float32), np.stack(ys).astype(np.float32)


def _require_target(channels, target):
    if target not in channels:
        raise ValueError(
            f"타깃 채널 {target!r} 가 데이터 채널 {channels} 에 없습니다. "
            f"export.feature_channels 에 '{target}' 를 포함하거나 다른 타깃을 지정하세요."
        )
    return channels.index(target)


def _augment(X, channels, dt, start, step_index, mean, std):
    """정규화 + 시각 sin/cos 채널 추가. 반환 (X_aug, names)."""
    N = X.shape[1]
    Xn = (X - mean) / std
    s, c = time_features(step_index, dt, start, N)
    X_aug = np.concatenate([Xn, s, c], axis=-1).astype(np.float32)
    return X_aug, channels + ["tod_sin", "tod_cos"]


def build_dataset(path: str, P: int = 12, Q: int = 3, target: str = "count",
                  splits=(0.7, 0.15, 0.15)) -> Dataset:
    X, channels, A, node_ids, dt, start, step_index = load_npz(path)
    T, N, F = X.shape
    target_idx = _require_target(channels, target)

    n_tr = int(T * splits[0])
    n_va = int(T * (splits[0] + splits[1]))
    mean = X[:n_tr].mean(axis=0)
    std = X[:n_tr].std(axis=0) + 1e-6

    X_aug, names = _augment(X, channels, dt, start, step_index, mean, std)
    xtr, ytr = _windows(X_aug[:n_tr], P, Q, target_idx)
    xva, yva = _windows(X_aug[n_tr:n_va], P, Q, target_idx)
    xte, yte = _windows(X_aug[n_va:], P, Q, target_idx)

    return Dataset(
        xtr=xtr, ytr=ytr, xva=xva, yva=yva, xte=xte, yte=yte,
        A_hat=normalized_adjacency(A), A_hat_bwd=normalized_adjacency(A.T),
        target_mean=mean[:, target_idx].astype(np.float32),
        target_std=std[:, target_idx].astype(np.float32),
        channels=names, node_ids=node_ids, target_idx=target_idx,
    )


def build_multirun_dataset(paths: Sequence[str], P: int = 12, Q: int = 3, target: str = "count",
                           val_runs: int = 1, test_runs: int = 1) -> Dataset:
    """여러 시나리오(시드) 파일을 run 단위로 train/val/test 홀드아웃 분할.

    같은 시나리오의 인접 시간조각이 train/test 에 섞이는 누설을 막아 일반화 추정이 더 정직해진다.
    """
    paths = list(paths)
    if len(paths) < 3:
        raise ValueError("다중 run 분할에는 최소 3개 파일이 필요합니다.")
    # 단위(value_scale)·채널·노드가 다른 파일을 섞으면 학습이 오염되므로 사전 차단
    # (특히 node 단위와 group 단위 X.npz 혼합 금지).
    schemas = [_read_schema(p) for p in paths]
    vs0, ch0, ids0 = schemas[0]
    for p, (vs, ch, ids) in zip(paths, schemas):
        if (vs, ch, ids) != (vs0, ch0, ids0):
            raise ValueError(
                f"run 파일 스키마가 일치하지 않습니다: {p!r}. "
                f"value_scale/channels/node_ids 가 같은 파일끼리만 묶으세요"
                f"(node 단위와 group 단위 X.npz 를 섞지 말 것)."
            )
    loaded = [load_npz(p) for p in paths]
    channels = loaded[0][1]
    target_idx = _require_target(channels, target)
    A = loaded[0][2]

    n = len(paths)
    n_te = max(1, int(test_runs))
    n_va = max(1, int(val_runs))
    te_idx = set(range(n - n_te, n))
    va_idx = set(range(n - n_te - n_va, n - n_te))

    # train run 들로 정규화 통계 산출(pooled)
    tr_stack = np.concatenate([loaded[i][0] for i in range(n) if i not in te_idx and i not in va_idx], axis=0)
    mean = tr_stack.mean(axis=0)
    std = tr_stack.std(axis=0) + 1e-6

    def windows_of(i):
        X, ch, _A, _ids, dt, start, step_index = loaded[i]
        X_aug, _ = _augment(X, channels, dt, start, step_index, mean, std)
        return _windows(X_aug, P, Q, target_idx)

    def gather(idxs):
        xs, ys = [], []
        for i in idxs:
            x, y = windows_of(i)
            if x.shape[0]:
                xs.append(x); ys.append(y)
        if not xs:
            return (np.zeros((0, P, A.shape[0], len(channels) + 2), np.float32),
                    np.zeros((0, Q, A.shape[0]), np.float32))
        return np.concatenate(xs), np.concatenate(ys)

    tr = [i for i in range(n) if i not in te_idx and i not in va_idx]
    xtr, ytr = gather(tr)
    xva, yva = gather(sorted(va_idx))
    xte, yte = gather(sorted(te_idx))

    return Dataset(
        xtr=xtr, ytr=ytr, xva=xva, yva=yva, xte=xte, yte=yte,
        A_hat=normalized_adjacency(A), A_hat_bwd=normalized_adjacency(A.T),
        target_mean=mean[:, target_idx].astype(np.float32),
        target_std=std[:, target_idx].astype(np.float32),
        channels=channels + ["tod_sin", "tod_cos"], node_ids=loaded[0][3], target_idx=target_idx,
    )


def load_stack_npz(path: str):
    """웹 '대량 생성'의 X_all.npz(X_all[R,T,N,F] + 공유 그래프 + seeds) 로더."""
    d = np.load(path, allow_pickle=True)
    X_all = d["X_all"].astype(np.float32)        # [R, T, N, F]
    channels = [str(c) for c in d["channels"]]
    A = d["adjacency"].astype(np.float32)
    node_ids = [str(x) for x in d["node_ids"]]
    seeds = [int(s) for s in d["seeds"]] if "seeds" in d.files else list(range(X_all.shape[0]))
    dt = float(d["dt_seconds"]) if "dt_seconds" in d.files else 1.0
    start = float(d["start_time_sec"]) if "start_time_sec" in d.files else 0.0
    step_index = (d["step_index"].astype(np.int64) if "step_index" in d.files
                  else np.arange(X_all.shape[1], dtype=np.int64))
    return X_all, channels, A, node_ids, seeds, dt, start, step_index


def build_dataset_from_stack(path: str, P: int = 12, Q: int = 3, target: str = "count",
                             val_runs: int = 1, test_runs: int = 1) -> Dataset:
    """대량 생성 X_all.npz 한 파일에서 run(시드) 단위 train/val/test 홀드아웃 데이터셋 구성.

    그래프는 1회분(공유), 혼잡도는 R개 run 의 X_all[R,T,N,F] 로 들어 있으므로,
    여러 개의 단일-run npz 를 모으는 build_multirun_dataset 과 동등한 분할을 한 파일에서 수행한다.
    """
    X_all, channels, A, node_ids, _seeds, dt, start, step_index = load_stack_npz(path)
    R = X_all.shape[0]
    if R < 3:
        raise ValueError("스택 데이터셋(X_all)에는 최소 3 run(시드) 이 필요합니다.")
    target_idx = _require_target(channels, target)
    n_te = max(1, int(test_runs))
    n_va = max(1, int(val_runs))
    te_idx = set(range(R - n_te, R))
    va_idx = set(range(R - n_te - n_va, R - n_te))
    tr = [i for i in range(R) if i not in te_idx and i not in va_idx]

    tr_stack = np.concatenate([X_all[i] for i in tr], axis=0)
    mean = tr_stack.mean(axis=0)
    std = tr_stack.std(axis=0) + 1e-6

    def gather(idxs):
        xs, ys = [], []
        for i in idxs:
            X_aug, _ = _augment(X_all[i], channels, dt, start, step_index, mean, std)
            x, y = _windows(X_aug, P, Q, target_idx)
            if x.shape[0]:
                xs.append(x); ys.append(y)
        if not xs:
            return (np.zeros((0, P, A.shape[0], len(channels) + 2), np.float32),
                    np.zeros((0, Q, A.shape[0]), np.float32))
        return np.concatenate(xs), np.concatenate(ys)

    xtr, ytr = gather(tr)
    xva, yva = gather(sorted(va_idx))
    xte, yte = gather(sorted(te_idx))

    return Dataset(
        xtr=xtr, ytr=ytr, xva=xva, yva=yva, xte=xte, yte=yte,
        A_hat=normalized_adjacency(A), A_hat_bwd=normalized_adjacency(A.T),
        target_mean=mean[:, target_idx].astype(np.float32),
        target_std=std[:, target_idx].astype(np.float32),
        channels=channels + ["tod_sin", "tod_cos"], node_ids=node_ids, target_idx=target_idx,
    )
