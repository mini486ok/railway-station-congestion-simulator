"""STGCN 최소 구현 (Yu et al., 2018 단순화판) — 참조 베이스라인.

입력  x: [B, F, P, N]  (배치, 특징채널, 시간, 노드)
출력  y: [B, Q, N]     (미래 Q 스텝 혼잡도 예측)

ST-Conv 블록: 시간 게이트 합성곱 → 공간 그래프 합성곱 → 시간 게이트 합성곱.
공간 합성곱은 정규화 인접행렬 Â 로 이웃 노드 정보를 전파한다.
(목적: 생성 데이터 형식·유효성 검증 및 데모. SOTA 추구 아님.)
"""
from __future__ import annotations

import torch
import torch.nn as nn


class TemporalGatedConv(nn.Module):
    def __init__(self, cin: int, cout: int, kt: int = 3):
        super().__init__()
        self.cout = cout
        self.conv = nn.Conv2d(cin, 2 * cout, (kt, 1))
        self.res = nn.Conv2d(cin, cout, (1, 1)) if cin != cout else None
        self.kt = kt

    def forward(self, x):  # x: [B, C, T, N]
        h = self.conv(x)                       # [B, 2cout, T-kt+1, N]
        p, q = h[:, : self.cout], h[:, self.cout :]
        out = p * torch.sigmoid(q)             # GLU
        res = (self.res(x) if self.res is not None else x)
        res = res[:, :, self.kt - 1 :, :]      # 시간 정렬(causal trim)
        return out + res


class SpatialGraphConv(nn.Module):
    def __init__(self, c: int):
        super().__init__()
        # 방향성 보존을 위해 forward·backward 전파를 함께 사용(역사 동선 양방향성)
        self.theta = nn.Linear(2 * c, c)

    def forward(self, x, A_fwd, A_bwd):  # x: [B, C, T, N]
        hf = torch.einsum("bctn,nm->bctm", x, A_fwd)
        hb = torch.einsum("bctn,nm->bctm", x, A_bwd)
        h = torch.cat([hf, hb], dim=1).permute(0, 2, 3, 1)  # [B, T, N, 2C]
        h = self.theta(h).permute(0, 3, 1, 2)               # [B, C, T, N]
        return torch.relu(h)


class STConvBlock(nn.Module):
    def __init__(self, cin: int, cout: int, kt: int = 3):
        super().__init__()
        self.t1 = TemporalGatedConv(cin, cout, kt)
        self.s = SpatialGraphConv(cout)
        self.t2 = TemporalGatedConv(cout, cout, kt)
        self.ln = nn.LayerNorm(cout)
        self.drop = nn.Dropout(0.1)

    def forward(self, x, A_fwd, A_bwd):
        x = self.t1(x)
        x = self.s(x, A_fwd, A_bwd)
        x = self.t2(x)
        x = self.ln(x.permute(0, 2, 3, 1)).permute(0, 3, 1, 2)
        return self.drop(x)


class STGCN(nn.Module):
    def __init__(self, num_features: int, horizon: int, hidden: int = 32, kt: int = 3):
        super().__init__()
        self.block1 = STConvBlock(num_features, hidden, kt)
        self.block2 = STConvBlock(hidden, hidden, kt)
        # 남은 시간축을 평균풀링으로 1로 수렴 → 노드별 Q 예측
        self.pool = nn.AdaptiveAvgPool2d((1, None))
        self.head = nn.Conv2d(hidden, horizon, (1, 1))

    def forward(self, x, A_fwd, A_bwd):  # x: [B, F, P, N]
        x = self.block1(x, A_fwd, A_bwd)
        x = self.block2(x, A_fwd, A_bwd)
        x = self.pool(x)               # [B, hidden, 1, N]
        x = self.head(x)               # [B, Q, 1, N]
        return x.squeeze(2)            # [B, Q, N]
