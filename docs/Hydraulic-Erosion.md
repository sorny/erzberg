# Hydraulic Erosion

The erosion simulation in `erzberg` is a direct implementation of the droplet-based method described in:

> Hans Beyer, *Implementation of a Method for Hydraulic Erosion* (2016).
> [Full text](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf)

The algorithm modifies the heightmap `Float32Array` in place. It runs inside a dedicated Web Worker to keep the rendering thread free.

---

## Algorithm

### Droplet initialisation

Each droplet is spawned at a uniformly random floating-point position $(x, y)$ on the grid with:

$$W_0 = 1, \quad v_0 = 1, \quad s_0 = 0, \quad \mathbf{d}_0 = \mathbf{0}$$

where $W$ is water volume, $v$ is speed, $s$ is carried sediment, and $\mathbf{d}$ is the direction vector.

### Gradient and movement

Because the droplet position is continuous, the terrain height and gradient at $(x, y)$ are estimated by bilinear interpolation over the four surrounding grid cells. The direction is updated by blending the previous direction with the downhill gradient:

$$\mathbf{d}_{t+1} = \mathbf{d}_t \cdot p_i - \nabla H(x_t, y_t) \cdot (1 - p_i)$$

$$\mathbf{x}_{t+1} = \mathbf{x}_t + \hat{\mathbf{d}}_{t+1}$$

where $p_i \in [0, 1]$ is the inertia parameter and $\hat{\mathbf{d}}$ is the unit direction vector. High inertia produces long, smooth river channels; low inertia produces short, fractal-like drainage patterns.

### Sediment capacity

The maximum sediment the droplet can carry is:

$$C = \max(\sin\theta,\, \epsilon) \cdot v_t \cdot W_t \cdot k_c$$

where $\theta$ is the local slope angle (derived from the height difference $\Delta h = H(\mathbf{x}_{t+1}) - H(\mathbf{x}_t)$), $\epsilon$ is a small floor to prevent division-like artefacts on flat ground, and $k_c$ is the capacity factor parameter.

### Erosion and deposition

**Erosion** ($s_t < C$): the droplet picks up sediment from the terrain. Material is removed from cells within the erosion radius using a smoothed radial brush $w_i$, so that:

$$\Delta H_i = -k_e \cdot (C - s_t) \cdot w_i$$

where $k_e$ is the erosion speed parameter. The brush weights sum to one, preventing grid-scale artefacts.

**Deposition** ($s_t \geq C$): the droplet deposits the excess sediment onto the four nearest grid cells weighted by bilinear coefficients $\beta_i$:

$$\Delta H_i = k_d \cdot (s_t - C) \cdot \beta_i$$

where $k_d$ is the deposition speed parameter.

### Evaporation and velocity update

At the end of each step:

$$W_{t+1} = W_t \cdot (1 - k_\text{evap})$$

$$v_{t+1} = \sqrt{\max(v_t^2 + \Delta h \cdot g,\; 0)}$$

where $k_\text{evap}$ is the evaporation rate and $g$ is the gravity parameter. The $\max(\cdot, 0)$ guard prevents imaginary speeds when a droplet climbs uphill.

### Termination

A droplet's lifecycle ends when any of the following conditions hold:
- it moves outside the grid boundary,
- $W_t$ falls below a minimum threshold,
- $\Delta h > 0$ and the droplet cannot escape the local pit (stuck in a depression).

---

## Parameters

| Parameter | Effect |
|---|---|
| Iterations | Total number of droplets simulated |
| Erosion radius | Brush size for material removal |
| Inertia | Smoothness of flow paths |
| Capacity factor | How much sediment a fast droplet can carry |
| Erosion speed | Rate of material removal |
| Deposition speed | Rate of sediment deposition |
| Evaporation rate | Droplet lifetime |
| Gravity | Acceleration down-slope |
