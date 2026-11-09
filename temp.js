objFile.Close  
Set objOut = CreateObject(\"\"Scripting.FileSystemObject\"\").CreateTextFile(\"\"C:\\Users\\samue\\OneDrive\\Documents\\GitHub\\nexus-os\\frontend\\app\\dashboard\\produtos\\page.tsx\"\", True)  
objOut.Write(s)  
objOut.Close  
