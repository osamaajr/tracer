/** A restrained burst that starts behind the confirmation tick and fans upward. */
export function populateConfetti(container: HTMLElement): void {
  container.replaceChildren();
  const colors = ["#1f211c", "#3f5d3b", "#7e956f", "#c9c0b1"];
  const trajectories = [
    [-88, -34], [-72, -62], [-52, -88], [-27, -108], [0, -118], [27, -105],
    [54, -86], [78, -58], [-62, -40], [64, -42], [-35, -72], [36, -76],
  ];
  for (let i = 0; i < trajectories.length; i++) {
    const piece = document.createElement("i");
    const [tx, ty] = trajectories[i]!;
    piece.style.setProperty("--x", "50%");
    piece.style.setProperty("--y", "51px");
    piece.style.setProperty("--tx", `${tx}px`);
    piece.style.setProperty("--ty", `${ty}px`);
    piece.style.setProperty("--r", `${-46 + i * 21}deg`);
    piece.style.setProperty("--w", `${i % 3 === 0 ? 3 : 2}px`);
    piece.style.setProperty("--h", `${i % 4 === 0 ? 8 : 6}px`);
    piece.style.setProperty("--delay", `${i * 12}ms`);
    piece.style.setProperty("--tone", colors[i % colors.length]!);
    container.append(piece);
  }
}
