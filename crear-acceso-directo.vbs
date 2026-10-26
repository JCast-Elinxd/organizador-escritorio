' Ejecuta este archivo UNA SOLA VEZ (doble clic). Crea un ícono en tu
' Escritorio llamado "Organizador" que abre la app directamente, sin
' consola visible — como cualquier otro programa instalado.
'
' Después de correr esto, ya no necesitas este archivo ni el de
' iniciar-organizador.vbs por separado: solo usa el ícono del Escritorio.
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
escritorio = WshShell.SpecialFolders("Desktop")

Set atajo = WshShell.CreateShortcut(escritorio & "\Organizador.lnk")
atajo.TargetPath = carpeta & "\iniciar-organizador.vbs"
atajo.WorkingDirectory = carpeta
atajo.IconLocation = carpeta & "\app_icon.ico"
atajo.Description = "Organizador de escritorio"
atajo.Save

MsgBox "Listo. Ya tienes un ícono ""Organizador"" en tu Escritorio.", vbInformation, "Organizador"
