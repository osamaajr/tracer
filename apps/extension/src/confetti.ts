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

/** Two cannon bursts followed by a full-popup cascade; generated only after saving. */
export function populateSavedConfetti(container: HTMLElement): void {
  const colors = ["#ff4e83", "#ffbe32", "#39c98a", "#4d9eff", "#9b6dff", "#ff7949", "#35cfdb"];
  const fragment = document.createDocumentFragment();
  const width = document.documentElement.clientWidth || 380;
  for (let index = 0; index < 108; index += 1) {
    const flight = document.createElement("span");
    const piece = document.createElement("i");
    const side = index % 2 === 0 ? 1 : -1;
    const random = () => Math.random();
    const shape = index % 9 === 0 ? "star" : index % 5 === 0 ? "ribbon" : index % 4 === 0 ? "dot" : "paper";
    flight.className = "saved-confetti-flight";
    piece.className = `saved-confetti-piece saved-confetti-piece--${shape}`;
    flight.style.left = side === 1 ? "-6px" : "calc(100% + 6px)";
    flight.style.setProperty("--peak-x", `${side * (width * (0.18 + random() * 0.67))}px`);
    flight.style.setProperty("--peak-y", `${-170 - random() * 240}px`);
    flight.style.setProperty("--land-x", `${side * (width * (0.1 + random() * 0.95))}px`);
    flight.style.setProperty("--land-y", `${230 + random() * 140}px`);
    flight.style.setProperty("--delay", `${index < 72 ? random() * 180 : 480 + random() * 180}ms`);
    flight.style.setProperty("--duration", `${2400 + random() * 800}ms`);
    flight.style.setProperty("--tone", colors[index % colors.length]!);
    flight.style.setProperty("--spin", `${side * (540 + random() * 720)}deg`);
    flight.style.setProperty("--r", `${random() * 180}deg`);
    flight.style.setProperty("--flutter", `${220 + random() * 260}ms`);
    flight.append(piece);
    fragment.append(flight);
  }
  for (let index = 0; index < 12; index += 1) {
    const sparkle = document.createElement("span");
    sparkle.className = "saved-confetti-sparkle";
    sparkle.style.left = `${18 + Math.random() * 64}%`;
    sparkle.style.top = `${80 + Math.random() * 125}px`;
    sparkle.style.setProperty("--delay", `${100 + Math.random() * 600}ms`);
    sparkle.style.setProperty("--tone", colors[index % colors.length]!);
    fragment.append(sparkle);
  }
  container.replaceChildren(fragment);
}
