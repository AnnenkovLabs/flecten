# Contribuir

[English](../../CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-Hans.md) · [Português (Brasil)](CONTRIBUTING.pt-BR.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [Українська](CONTRIBUTING.uk.md) · [Русский](CONTRIBUTING.ru.md)

## Preparación

Necesitas Bun 1.4 y Node 20 o superior. Node solo es necesario para Electron.

```bash
bun install
bun run dev help
bun run app:dev
```

## Antes de un PR

Ejecuta todas las comprobaciones:

```bash
bun test
bun run check
bun run lint
bun run build:ui
```

Si cambiaste la ventana, adjunta una captura o describe una comprobación en el navegador a 1480x940 y 1180x640. Revisa los estados: vacío, carga, detenido, reduced motion.

## Reglas de código

- Un archivo se ocupa de una cosa. Límite blando 300 líneas, límite duro 500.
- `core` no importa `ui`, `shell` ni `store`.
- La interfaz no lee archivos ni llama a modelos.
- Los datos del modelo, archivos y web se validan con un esquema en la frontera.
- El núcleo no escribe en `console`. Los eventos van por el bus.
- Los prompts viven en `prompts/`, no en el código.
- Los secretos se recortan antes de escribir nada en un log.
- Un comentario explica el motivo, no la acción.
- Una simplificación temporal se marca con `ponytail:` con su límite y un camino de evolución.

## Interfaz

- Lee `design.md` antes de cambiar el comportamiento visual.
- Los componentes viven en `ui/src/components`, el estado y las funciones puras en `ui/src/lib`.
- Los datos de demo solo cambian en `ui/src/lib/demo.ts`. Un componente no guarda una copia de esos datos.
- Los tokens, fuentes y estilos base viven en `ui/src/app.css`. No añadas un segundo conjunto de tokens.
- Un componente nuevo recibe datos por props. Importar `demo.ts` directamente solo se permite en los contenedores de pantalla.
- Los elementos interactivos funcionan con teclado y tienen `aria-label` o una etiqueta visible.
- La animación no es necesaria para entender el estado. `prefers-reduced-motion` debe dejar un fotograma estático.

## Dependencias

Una nueva dependencia requiere un registro de decisión: contexto, decisión, consecuencias. Revisa primero la biblioteca estándar de Bun, luego un paquete.

## Commits

Un commit es un cambio de significado. Mensaje en imperativo: `add spec parsing`, `fix page boundary`. Los secretos y `.liquid/` nunca se commitean.

## Comportamiento

Discute código y decisiones, no personas. Los insultos, el acoso y publicar datos de otros son inaceptables. Reporta un problema en privado al propietario del repositorio. Consulta el [Código de conducta](../../CODE_OF_CONDUCT.md).
