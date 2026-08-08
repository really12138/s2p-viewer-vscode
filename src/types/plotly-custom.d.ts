declare module "plotly.js/lib/core" {
  const Plotly: typeof import("plotly.js");
  export default Plotly;
}

declare module "plotly.js/lib/scatter" {
  const scatter: import("plotly.js").PlotlyModule;
  export default scatter;
}

declare module "plotly.js/lib/scattersmith" {
  const scatterSmith: import("plotly.js").PlotlyModule;
  export default scatterSmith;
}
