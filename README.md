# Build an application

This section describes how to build an nRF Connect SDK application using the nRF Connect for VS Code extension. The build process is managed through a build configuration, which defines the board target, SDK version, toolchain, and optional configuration files.

## Prerequisites

Before building an application, ensure:

- nRF Connect for VS Code extension is installed
- nRF Connect SDK (NCS) is installed and configured
- Toolchain version matches the selected SDK version
- Application is already created or imported in VS Code

## Build procedure

1. Open the nRF Connect for VS Code extension  
2. Go to Applications View  
3. Select your application  

Click Add Build Configuration. This defines how the application will be built.

Configure the build as follows:

1. Select the installed nRF Connect SDK version  
2. Select the matching toolchain version  
3. Set Optimization level (size, speed, or debugging) to Use project default  
4. Ensure the Generate only checkbox is not selected  
5. Keep the default sysbuild setting  
6. Click Generate and Build  

The extension will generate the configuration files and execute the build process.

## Flashing the application

To flash the built application, open the Actions View and click Flash.