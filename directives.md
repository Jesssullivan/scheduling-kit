
---

Hi there!

Today we are going to be deeply focusing on two complex and core bazel modules, each of which need extensive rework and architectural analysis, refactoring and development: scheduling-kit and scheduling-bridge.

These two packages seek to (and currently do not) differentiate and completely describe the following:
Scheduling-bridge abstracts and disambiguates scheduler *logic* monadically, agnostic of the scheduling “backend”. This is incusive of fuzzy in, fuzzy out, browser automation friendly scheduler action (ie. the actions a user takes to schedule an appointment, meeting etc; this may include date picking, soap notes, form panels, payment etc) which is to be formally represented as a DAG (which is exactly what a scheduler client flow is; a DAG of abstractable functions).  We structure this scheduling-bridge this was as we seek to abstract across all off the shelf schedulers (currently we have loosely / to a very rough MVP degree built headless browser based automations of acuity, though not at all in the properly formal, top down paradigm we require).  This includes the complex and important approaches to adding payment methods not nessisarily natively supported by the backend vendor (such as adding venmo payment )

The thesis of scheduling-kit is to allow growing small buisnesses with a flair for data privacy / open source software currently leveraging off the shelf scheduling platforms to be able to seamlessly move *off* these saas systems to onprem systems, and / or modify the user's flow and expereince for s heduling without needing API access to the closed source schedulers (this includes operations such as compliance and handling medical records, which not all entry-level scheduling systems properly impliment).    All the core feartures / building blocks / packages are to be pulled and built in conjunction with the tinyland-inc bazel module ecosystem, with full RBE and bazel fluency for remote checks, remote builds, temote tests, runner infra, build infra etc.



Scheduling-kit is aimed to be a SOTA, FOSS backend replacement to services such as acuity scheduling, glossgenious, varago, massagebook, etc.  It must be designed specifically to be used in conjunctionn with scheudling-bridge, being the defacto "fully owned / on-prem" alternative to acuity / glossgenius / calcom / massagebook etc; this is to be a fully two way application with feature parity with acuity scheduling.  Currently the line between scheduling-kit and scheudling-bridge is not at all correctly enforced, and scheudling-kit in not anywhere near to MVP status.  All the core feartures / building blocks / packages are to be pulled and built in conjunction with the tinyland-inc bazel module ecosystem, with full RBE and bazel fluency for remote checks, remote builds, temote tests, runner infra, build infra etc. 


It may be worth deeply exploring the linear rockets,  initiatives and gh issues relating to these modules; explore the deployment and environment structures in MassageIthaca for example where these have spawned developent use.  I will also be building out a fresh development only acuity account (as well as glossgensious and others) for our own internal testing and use, so we don't need to keep using client's acounts for reference. 
 


