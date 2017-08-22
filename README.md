

<h1 align="center">
    <img src="https://i.imgur.com/pRMwGOj.png" alt="squash" width="100" height="118">
  <br>
 Squash: debugger for microservices
 <br>
  VS Code extension
</h1>


<h4 align="center">Debug your microservices application from VS Code.</h4>
<BR><BR>

## What is squash ?
Squash, a tool for debugging distributed applications, is designed to bring the strength of modern debuggers and the convenience of their IDEs to microservices developers. Squash uses popular, powerful and mature debuggers, and integrates them seamlessly with leading container orchestration platform. This allows devs to use the debugger of their choice, and the IDEs that support it, to debug microservices on any platform.

## What is squash extention ?
The Squash VS Code extenstion allows Squash to use Visual Studio Code as its user interface. 
After installing this extension Squash commands are available in VS Code command palette. 

## With Squash, you can:
* Live debugging cross multi microservices
* Debug container in a pod
* Debug a service
* Set breakpoints
* Step through the code
* View and modify values of variables
* and more ...

***

## Demo

In the following demo we  debug an application that adds two numbers. As you can see, it currently fails misearbly at adding 9 to 99. The applications is composed of two microservices. We  set breakpoints in both, then step thought the application, while monitoring its variables. At some point we  identify the problem, and test it by changing the value of the variable isadd before resuming the exectution of the appliation.

<img src="images/squash-demo-2.gif" alt="Squash Demo" />

An annotated version of this demo can be found [here](https://youtu.be/5aNPfwVvLvA).
## Examles
* [Debug application that runs on Kubernetes](docs/example-app-kubernetes.md)
