import { useEffect, useState } from "react";

const useFpsOptimization = (render: () => void, max = 24): number => {
  const [hz, setHz] = useState(1);
  useEffect(() => {
    const loop = window.setInterval(() => {
      const start = performance.now();
      render();
      const newHz = Math.max(
        Math.floor((performance.now() - start) / 1000),
        max
      );
      if (hz !== newHz) setHz(newHz);
    }, 1000 / hz);
    return () => window.clearInterval(loop);
  }, [render, hz, setHz, max]);
  return hz;
};

export default useFpsOptimization;
