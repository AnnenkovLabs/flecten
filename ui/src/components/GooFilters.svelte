<script lang="ts">
</script>

<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <filter
      id="goo"
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
      <feColorMatrix
        in="blur"
        mode="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
      />
    </filter>
    <filter
      id="goo-tight"
      x="-40%"
      y="-40%"
      width="180%"
      height="180%"
      color-interpolation-filters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
      <feColorMatrix
        in="blur"
        mode="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"
      />
    </filter>
  </defs>
</svg>