import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "reactflow";
import { round } from "../util";

// 가중치 라벨 + 삭제(✕) 버튼이 달린 엣지. ✕ 클릭으로 캔버스에서 바로 링크 삭제.
export default function DeletableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data, selected,
}) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const disabled = data?.running;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={"edge-tools" + (selected ? " sel" : "")}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <span className="edge-w">w={round(data?.weight ?? 0, 2)}</span>
          {!disabled && (
            <button
              type="button"
              className="edge-del"
              title="링크 삭제"
              aria-label="링크 삭제"
              onClick={(e) => {
                e.stopPropagation();
                data?.onDelete && data.onDelete();
              }}
            >
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
