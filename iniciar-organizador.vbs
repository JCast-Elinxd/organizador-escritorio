' Doble clic en este archivo = abrir el organizador como una app normal,
' sin ventana de consola visible. No necesitas escribir "npm start".
'
' Cómo funciona: ejecuta "npm start" pero con la ventana de CMD oculta
' (el 0 al final de Run significa "ventana oculta").
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = carpeta

WshShell.Run "cmd /c npm start", 0, False
