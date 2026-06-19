"""참조 STGCN 학습·평가 (로컬, PyTorch CPU/GPU).

사용 예:
    python ml/train.py --data out/run1/X.npz --epochs 30 --P 12 --Q 3

생성 데이터(X.npz)로 STGCN 을 학습하고, 테스트 구간에서 MAE/RMSE/MAPE 를 보고한다.
목적: 시뮬레이터 데이터의 형식·유효성을 end-to-end 로 검증(데모). SOTA 추구 아님.
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dataset import build_dataset, build_multirun_dataset  # noqa: E402


def metrics(pred, true):
    """pred/true: [B, Q, N] (역정규화된 인원수)."""
    err = pred - true
    mae = np.mean(np.abs(err))
    rmse = np.sqrt(np.mean(err ** 2))
    denom = np.maximum(np.abs(true), 1.0)  # 0 division 방지
    mape = np.mean(np.abs(err) / denom) * 100.0
    return float(mae), float(rmse), float(mape)


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔 한글/특수문자 출력 보정
    except Exception:
        pass

    import torch
    from torch.utils.data import DataLoader, TensorDataset
    from stgcn import STGCN

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, nargs="+", help="X.npz 경로(여러 개면 run 단위 홀드아웃 분할)")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--P", type=int, default=12, help="입력 길이(스텝)")
    ap.add_argument("--Q", type=int, default=3, help="예측 길이(스텝)")
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # STGCN 시간축 축소: 2블록 × 2 temporal conv × (kt-1), kt=3 → 8스텝 감소. P>=9 필요.
    kt = 3
    min_P = 2 * 2 * (kt - 1) + 1
    if args.P < min_P:
        print(f"[오류] --P 는 최소 {min_P} 이상이어야 합니다(STGCN 시간축 축소). 현재 P={args.P}.")
        return 1

    if len(args.data) == 1:
        ds = build_dataset(args.data[0], P=args.P, Q=args.Q)
    else:
        ds = build_multirun_dataset(args.data, P=args.P, Q=args.Q)
    F = ds.xtr.shape[-1]
    N = ds.xtr.shape[2]
    print(f"[데이터] train {ds.xtr.shape[0]} / val {ds.xva.shape[0]} / test {ds.xte.shape[0]} "
          f"윈도우, 노드 {N}, 특징 {F}, 채널 {ds.channels}")
    if ds.xtr.shape[0] == 0 or ds.xte.shape[0] == 0:
        print("윈도우가 부족합니다. 더 긴 시뮬(total_steps↑) 또는 집계간격↓ 로 데이터를 늘리세요.")
        return 1

    A_hat = torch.tensor(ds.A_hat, device=device)
    A_bwd = torch.tensor(ds.A_hat_bwd, device=device)

    def to_x(x):  # [B,P,N,F] -> [B,F,P,N]
        return torch.tensor(x, device=device).permute(0, 3, 1, 2)

    xtr, ytr = to_x(ds.xtr), torch.tensor(ds.ytr, device=device)
    xva, yva = to_x(ds.xva), torch.tensor(ds.yva, device=device)
    xte, yte = to_x(ds.xte), torch.tensor(ds.yte, device=device)

    loader = DataLoader(TensorDataset(xtr, ytr), batch_size=args.batch, shuffle=True)

    model = STGCN(num_features=F, horizon=args.Q, hidden=args.hidden).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    lossf = torch.nn.MSELoss()

    best_val = float("inf")
    for ep in range(1, args.epochs + 1):
        model.train()
        tot = 0.0
        for xb, yb in loader:
            opt.zero_grad()
            pred = model(xb, A_hat, A_bwd)
            loss = lossf(pred, yb)
            loss.backward()
            opt.step()
            tot += loss.item() * xb.shape[0]
        model.eval()
        with torch.no_grad():
            vloss = lossf(model(xva, A_hat, A_bwd), yva).item() if xva.shape[0] else float("nan")
        best_val = min(best_val, vloss)
        if ep % max(1, args.epochs // 10) == 0 or ep == 1:
            print(f"  epoch {ep:3d}  train_mse {tot/len(xtr):.4f}  val_mse {vloss:.4f}")

    # 테스트 평가(역정규화)
    model.eval()
    with torch.no_grad():
        pred = model(xte, A_hat, A_bwd).cpu().numpy()
    mean = ds.target_mean[None, None, :]
    std = ds.target_std[None, None, :]
    pred_d = pred * std + mean
    true_d = ds.yte * std + mean
    mae, rmse, mape = metrics(pred_d, true_d)

    # persistence 베이스라인(마지막 입력값을 미래로 그대로 예측)
    last = ds.xte[:, -1, :, ds.target_idx]  # [B,N] (정규화)
    pers = np.repeat(last[:, None, :], args.Q, axis=1)
    pers_d = pers * std + mean
    pmae, prmse, pmape = metrics(pers_d, true_d)

    print("\n[테스트 결과 — 역정규화된 인원수 기준]")
    print(f"  STGCN        MAE {mae:.3f}  RMSE {rmse:.3f}  MAPE {mape:.1f}%")
    print(f"  Persistence  MAE {pmae:.3f}  RMSE {prmse:.3f}  MAPE {pmape:.1f}%")
    print(f"  → STGCN 이 단순 지속 예측 대비 MAE {(1 - mae / max(pmae,1e-9)) * 100:.1f}% 개선"
          if mae < pmae else "  → (베이스라인 수준; 더 많은/긴 데이터 권장)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
