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

/** A brief colourful burst around the saved heading. */
export function populateSavedConfetti(container: HTMLElement): void {
  const colors = ["#e8ad36", "#4aaf89", "#699bdd", "#e58487", "#9b86cb"];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 28; index += 1) {
    const flight = document.createElement("span");
    const piece = document.createElement("i");
    const side = index % 2 === 0 ? 1 : -1;
    const spread = side * (45 + Math.random() * 95);
    const shape = index % 7 === 0 ? "star" : index % 4 === 0 ? "dot" : "paper";
    flight.className = "saved-confetti-flight";
    piece.className = `saved-confetti-piece saved-confetti-piece--${shape}`;
    flight.style.left = "50%";
    flight.style.setProperty("--peak-x", `${spread}px`);
    flight.style.setProperty("--peak-y", `${-25 - Math.random() * 55}px`);
    flight.style.setProperty("--land-x", `${spread * 1.12}px`);
    flight.style.setProperty("--land-y", `${12 + Math.random() * 30}px`);
    flight.style.setProperty("--delay", `${Math.random() * 100}ms`);
    flight.style.setProperty("--duration", `${1100 + Math.random() * 400}ms`);
    flight.style.setProperty("--tone", colors[index % colors.length]!);
    flight.style.setProperty("--spin", `${side * (180 + Math.random() * 180)}deg`);
    flight.style.setProperty("--r", `${Math.random() * 180}deg`);
    flight.style.setProperty("--flutter", `${300 + Math.random() * 180}ms`);
    flight.append(piece);
    fragment.append(flight);
  }
  container.replaceChildren(fragment);
}
