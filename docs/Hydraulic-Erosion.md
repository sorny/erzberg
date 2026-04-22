# Hydraulic Erosion

The procedural terrain modification in `erzberg` is driven by a physically-based droplet simulation. This enables realistic, non-destructive carving of riverbeds and drainage basins directly into the heightmap.

## Acknowledgements
The algorithm is a direct implementation of the techniques described in Hans Beyer's thesis:
> [**"Implementation of a Method for Hydraulic Erosion"** by Hans Beyer](https://ardordeosis.github.io/implementation-of-a-method-for-hydraulic-erosion/thesis-beyer.pdf)

## The Algorithm

The simulation is **Particle-Based**. It simulates the lifecycle of millions of independent water droplets ("raindrops") falling onto the terrain.

### 1. Droplet Spawning
A droplet is spawned at a random floating-point $(x, y)$ coordinate on the grid. It begins with initial properties:
- **Water Volume**: $W = 1.0$
- **Velocity**: $V = 1.0$
- **Sediment**: $S = 0.0$
- **Direction**: $dir = (0, 0)$

### 2. Movement & Gradient Calculation
At each step, the droplet evaluates the slope of the terrain to decide where to flow. Because the droplet exists at a continuous floating-point coordinate, the terrain height and gradient are calculated using **Bilinear Interpolation** of the 4 nearest discrete grid cells.

The droplet's direction is updated using inertia, blending its previous direction with the new gradient vector:
$$ dir_{new} = (dir_{old} \times inertia) - (\nabla H \times (1 - inertia)) $$
$$ pos_{new} = pos_{old} + dir_{new} $$

### 3. Erosion and Deposition
The droplet calculates its theoretical **Sediment Capacity** ($C$). This dictates how much dirt the water can carry, which is proportional to its velocity, water volume, and the local slope.

- **Erosion ($S < C$)**: If the droplet is carrying less sediment than its capacity, it picks up dirt from the terrain. It removes height from the terrain cells within a defined `erosionRadius`, using a weighted brush.
- **Deposition ($S > C$)**: If the droplet is carrying too much sediment (often because it slowed down in a valley), it drops the excess sediment back onto the terrain. The dropped sediment is distributed to the 4 nearest grid cells using bilinear weighting.

### 4. Evaporation & Termination
At the end of each step:
- The droplet evaporates a small amount of water: $W = W \times (1 - evaporationRate)$.
- Velocity is updated based on gravity and the change in height: $V = \sqrt{V^2 + \Delta H \times gravity}$.

The droplet's life ends if:
1. It flows off the edge of the map.
2. Its water volume reaches zero.
3. It becomes trapped in a local pit where it can no longer flow downhill.

## Multi-threaded Concurrency
Because this algorithm requires millions of iterations (one iteration = one droplet life cycle) and modifies a large `Float32Array`, it is highly CPU-intensive. 

In `erzberg`, the erosion loop runs inside a dedicated **Web Worker** and is executed off the main thread. This ensures the React Three Fiber UI remains at a consistent 60 FPS while the landscape is being actively sculpted.
