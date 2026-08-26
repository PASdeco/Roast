import { ImageResponse } from "next/og";

/**
 * Purpose-built share card (blueprint §23) — not a screenshot of the app.
 * 1:1 for X timelines, works in light treatment, brand-consistent.
 * Data comes from the roast store; falls back to a branded default card.
 */
export const contentType = "image/png";
export const size = { width: 1080, height: 1080 };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get("username") || "@you").slice(0, 40);
  const thesis = (searchParams.get("thesis") || "The jury has spoken.").slice(0, 180);
  const roast = (searchParams.get("roast") || "Roast yours now.").slice(0, 200);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#faf8f4",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "#c2410c",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                color: "white",
              }}
            >
              🔥
            </div>
            <div
          style={{ display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: "#16150f",
                letterSpacing: "-0.02em",
              }}
            >
              Roast My X
            </div>
          </div>
          <div
          style={{ display: "flex",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "#0f766e",
              textTransform: "uppercase",
            }}
          >
            GenLayer Jury
          </div>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: "36px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
          style={{ display: "flex",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "#75705f",
                textTransform: "uppercase",
              }}
            >
              {username} — the thesis
            </div>
            <div
          style={{ display: "flex",
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.15,
                color: "#16150f",
                letterSpacing: "-0.02em",
              }}
            >
              “{thesis}”
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              borderLeft: "6px solid #c2410c",
              paddingLeft: "28px",
            }}
          >
            <div
          style={{ display: "flex",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "#c2410c",
                textTransform: "uppercase",
              }}
            >
              The roast
            </div>
            <div
          style={{ display: "flex", fontSize: 32, lineHeight: 1.35, color: "#9a3412" }}>
              “{roast}”
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#75705f",
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <span style={{ display: "flex" }}>⚖️</span>
            <span style={{ display: "flex" }}>5 independent evaluations</span>
          </div>
          <div
          style={{ display: "flex", fontWeight: 700, color: "#16150f" }}>roastmyx.xyz</div>
        </div>
      </div>
    ),
    size,
  );
}
