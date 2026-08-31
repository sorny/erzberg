# Hydraulic Erosion

`erzberg` erodes terrain with the droplet method of Hans Beyer:

> Hans Beyer, *Implementation of a Method for Hydraulic Erosion* (2016).
> [Full text](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf)

The algorithm changes the heightmap `Float32Array` in place. It runs in its own
Web Worker, so the main thread stays free.

---

## Algorithm

### Droplet start values

Each droplet starts at a random position $(x, y)$ on the grid. The position is a
floating-point value, not a cell index. The start values are:

$$W_0 = 1, \quad v_0 = 1, \quad s_0 = 0, \quad \mathbf{d}_0 = \mathbf{0}$$

$W$ is the water volume. $v$ is the speed. $s$ is the carried sediment.
$\mathbf{d}$ is the direction vector.

### Gradient and movement

The droplet position is continuous. The algorithm gets the height and the
gradient at $(x, y)$ from a bilinear tap over the four cells around it. It then
blends the previous direction with the downhill gradient:

$$\mathbf{d}_{t+1} = \mathbf{d}_t \cdot p_i - \nabla H(x_t, y_t) \cdot (1 - p_i)$$

$$\mathbf{x}_{t+1} = \mathbf{x}_t + \hat{\mathbf{d}}_{t+1}$$

$p_i \in [0, 1]$ is the inertia parameter. $\hat{\mathbf{d}}$ is the unit
direction vector. High inertia gives long, smooth river channels. Low inertia
gives short drainage patterns with a fractal shape.

### Sediment capacity

This is the maximum sediment that the droplet can carry:

$$C = \max(\sin\theta,\, \epsilon) \cdot v_t \cdot W_t \cdot k_c$$

$\theta$ is the local slope angle. It comes from the height difference
$\Delta h = H(\mathbf{x}_{t+1}) - H(\mathbf{x}_t)$. $\epsilon$ is a small floor
value. It prevents artefacts on flat ground, where the slope angle goes to zero.
$k_c$ is the capacity factor parameter.

### Erosion and deposition

**Erosion** applies when $s_t < C$. The droplet takes sediment from the terrain.
The algorithm removes material from the cells inside the erosion radius. It
weights each cell with a smooth radial brush $w_i$:

$$\Delta H_i = -k_e \cdot (C - s_t) \cdot w_i$$

$k_e$ is the erosion speed parameter. The brush weights add up to one, so the
grid pitch leaves no artefacts of its own.

**Deposition** applies when $s_t \geq C$. The droplet puts the excess sediment on
the four nearest cells. It weights them with the bilinear coefficients $\beta_i$:

$$\Delta H_i = k_d \cdot (s_t - C) \cdot \beta_i$$

$k_d$ is the deposition speed parameter.

### Evaporation and speed

Each step ends with these two updates:

$$W_{t+1} = W_t \cdot (1 - k_\text{evap})$$

$$v_{t+1} = \sqrt{\max(v_t^2 + \Delta h \cdot g,\; 0)}$$

$k_\text{evap}$ is the evaporation rate. $g$ is the gravity parameter. The
$\max(\cdot, 0)$ guard prevents an imaginary speed when a droplet climbs uphill.

### Termination

A droplet stops when one of these conditions is true:

- The droplet moves outside the grid.
- The water volume $W_t$ becomes less than a minimum value.
- $\Delta h > 0$ and the droplet cannot get out of a local pit.

---

## Parameters

| Parameter | Effect |
|---|---|
| Iterations | The number of droplets in one run |
| Erosion radius | The brush size for material removal |
| Inertia | The smoothness of the flow paths |
| Capacity factor | How much sediment a fast droplet can carry |
| Erosion speed | The rate of material removal |
| Deposition speed | The rate of sediment deposition |
| Evaporation rate | The droplet lifetime |
| Gravity | The acceleration down the slope |
