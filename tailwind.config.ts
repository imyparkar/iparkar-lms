import type { Config } from "tailwindcss";

/**
 * iParkar design-system tokens (from the iParkar Design System artifact).
 * Use these names only; don't introduce new greys or blues.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        midnight: "#02093a",
        marigold: "#ffb110",
        action: "#0075de",
        coral: "#f64932",
        paper: "#f6f5f4",
        ink: {
          DEFAULT: "#000000",
          95: "rgba(0,0,0,0.95)",
          90: "rgba(0,0,0,0.9)",
          60: "rgba(0,0,0,0.6)",
          54: "rgba(0,0,0,0.54)",
          40: "rgba(0,0,0,0.4)",
          20: "rgba(0,0,0,0.2)",
        },
        charcoal: "#111111",
        graphite: "#615d59",
        slate: "#696969",
        stone: "#757575",
        "sky-tint": "#e6f3fe",
        "sky-wash": "#62aef0",
        "signal-blue": "#097fe8",
        saffron: "#e89d01",
        vermillion: "#e32d14",
        mocha: "#b18164",
        peach: "#f6d5b8",
        hairline: "rgba(0,0,0,0.08)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["Source Serif 4", "Georgia", "Times New Roman", "serif"],
      },
      fontSize: {
        "display-sm": ["54px", { lineHeight: "1.04", letterSpacing: "-1.89px", fontWeight: "600" }],
        "heading-lg": ["48px", { lineHeight: "1.5", fontWeight: "600" }],
        heading: ["40px", { lineHeight: "1.5", fontWeight: "400" }],
        "heading-sm": ["22px", { lineHeight: "1.27", letterSpacing: "-0.242px", fontWeight: "700" }],
        subheading: ["20px", { lineHeight: "1", fontWeight: "500" }],
        body: ["16px", { lineHeight: "1.5" }],
        "body-sm": ["14px", { lineHeight: "1.43" }],
        caption: ["12px", { lineHeight: "1.33", letterSpacing: "0.12px", fontWeight: "500" }],
        lead: ["18px", { lineHeight: "1.56" }],
      },
      borderRadius: { small: "4px", button: "8px", card: "12px", pill: "9999px" },
      boxShadow: {
        nav: "0px 0.7px 1.462px 0px rgba(0,0,0,0.015), 0px 3px 9px 0px rgba(0,0,0,0.03)",
        mockup: "0px 4px 12px rgba(0,0,0,0.1)",
      },
      maxWidth: { page: "1440px", content: "1120px" },
      spacing: { nav: "64px" },
    },
  },
  plugins: [],
} satisfies Config;
