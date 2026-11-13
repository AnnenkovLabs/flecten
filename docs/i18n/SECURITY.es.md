# Seguridad

[English](../../SECURITY.md) · [简体中文](SECURITY.zh-Hans.md) · [Português (Brasil)](SECURITY.pt-BR.md) · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · [Українська](SECURITY.uk.md) · [Русский](SECURITY.ru.md)

## Versiones compatibles

Solo se admite la rama `main`.

## Cómo reportar

No abras un issue público para una vulnerabilidad. Usa un security advisory privado de GitHub o escribe al propietario del repositorio. Incluye la versión, los pasos de reproducción y el impacto potencial.

Espera una respuesta en un plazo de 7 días. La corrección y la divulgación de detalles se coordinan con el autor del reporte.

## Qué revisar primero

- path traversal en el protocolo `liquid://`;
- el puente `preload` y el acceso a `ipcRenderer`;
- `contextIsolation`, `sandbox` y `nodeIntegration` en la ventana;
- CSP y la carga de recursos externos;
- el recorte de tokens en logs y `events.jsonl`;
- comandos `bash` y escritura de archivos fuera del conjunto permitido;
- el lanzamiento de servidores MCP y hooks desde `flecten.config.json`;
- el paso del entorno a procesos MCP hijos;
- la inyección de instrucciones mediante `SKILL.md` y respuestas MCP.

Las fronteras arquitectónicas de seguridad se describen en [docs/SECURITY.md](../../docs/SECURITY.md).
