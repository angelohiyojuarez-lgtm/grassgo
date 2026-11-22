# Instrucciones del agente — GrassGo

Antes de programar o modificar cualquier archivo:

1. Lee íntegramente `CONTEXTO_GRASSGO.md`.
2. Inspecciona el repositorio real y reporta qué existe. No des por implementadas funciones mencionadas en los requisitos.
3. Respeta la visión multiestablecimiento de GrassGo con tres roles: cliente, administrador por establecimiento y superadministrador de plataforma.
4. Asegura el aislamiento de datos entre establecimientos en el backend; no confiar en permisos solo del frontend.
5. Trabaja en incrementos pequeños y verificables; evita grandes refactorizaciones sin autorización.
6. Mantén código claro, estructura consistente, migraciones, pruebas y documentación en español accesible.
7. Antes de elegir o cambiar frameworks, consulta el stack ya existente y explica la decisión.
8. Consulta requisitos comerciales o políticas no definidos. No inventes tarifas, planes, reglas de reembolso o disponibilidad.
9. No marques pagos como verificados solo por recibir una imagen; para el piloto Yape/Plin se validan manualmente.
10. Al finalizar cada tarea, resume archivos modificados, resultado de pruebas, comandos para ejecutar en Windows y siguiente paso sugerido.

## Comienza por esto

Haz una auditoría del proyecto: estructura de archivos, dependencias, interfaz actual, servicios existentes y estado del backend. Luego propone un roadmap preciso para implementar primero autenticación/roles/multi-tenancy. No programes todo el sistema en una sola ejecución.
