# Vesta para Android

La aplicación móvil de Vesta usa React Native 0.86 y Expo SDK 57. El proyecto
nativo vive en `android/`, usa el paquete `com.alangael.vesta` y conserva las
mismas funciones del cliente iOS: armario privado, carga desde galería,
vinculación por enlace `vesta://`, generación de avatar, probador y Looks.

## Requisitos locales

- Node.js 22 o posterior
- pnpm
- JDK 17 o 21
- Android Studio con Android SDK 36, Build Tools 36.0.0 y NDK 27.1.12297006

## Ejecutar en emulador o teléfono

```bash
cd mobile
pnpm install --frozen-lockfile
pnpm android
```

Para un teléfono físico, activa las opciones de desarrollador y la depuración
USB antes de ejecutar el comando. También puedes abrir `mobile/android` en
Android Studio y lanzar la configuración `app`.

## Generar instalables

El APK local de release para teléfonos ARM64 sirve para pruebas internas:

```bash
cd mobile
pnpm android:release:arm64
```

Queda en `android/app/build/outputs/apk/release/app-release.apk`. El proyecto
generado usa la clave de depuración para esa compilación local; no se debe subir
ese APK a Google Play.

Para obtener un APK interno firmado por Expo Application Services:

```bash
cd mobile
npx eas-cli build --platform android --profile preview
```

Para Google Play, genera un Android App Bundle firmado:

```bash
cd mobile
npx eas-cli build --platform android --profile production
```

La primera ejecución de EAS pedirá iniciar sesión, crear o vincular el proyecto
de Expo y configurar la clave de firma. No confirmes una nueva huella de firma si
la aplicación ya fue publicada con otra clave.

## Regenerar el proyecto nativo

Después de cambiar plugins o propiedades en `app.json`:

```bash
cd mobile
pnpm prebuild:android
```

Revisa el diff de `android/` antes de confirmar los cambios.
