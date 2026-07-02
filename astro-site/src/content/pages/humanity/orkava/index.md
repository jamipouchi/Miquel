# Tres mesos intentant construir software per a farmàcies

Hem entrevistat unes 70 farmàcies, hem instal·lat el producte a 12 i hem acabat concloent que el model de negoci en que crèiem no funciona.

## Per què farmàcia

En Lluís és amic meu, fill de farmacèutics, ha passat tota la vida a la farmàcia. Em va explicar els seus problemes, idees i el panorama actual del software. Jo hi vaig veure l'oportunitat d'aportar valor.

## El mercat de la farmàcia

La farmàcia és un negoci de marge baix que cada cop és més difícil de defensar. Hi ha dos camins que les farmàcies estan prenent per mantenir-se competitives.

### Volum i marge

Una estratègia en augment a Europa, i amb gran èxit a França, és unir la farmàcia a un grup. Els grups de compra tenen més poder de negociació que les farmàcies independents, i per tant costos d'adquisició més baixos. Més enllà dels grups de compra hi ha les "marques", que afegeixen imatge, consultoria i eines de gestió.

Tots dos models són atractius per a la farmàcia perquè simplifiquen la gestió i ajuden a pujar el sell-out. En una situació on la gestió integral requereix cada cop més feina i el retorn és més difícil d'aconseguir, és fàcil entendre per què creixen.

### Diferenciació i serveis

La farmàcia cada vegada més es posiciona com a punt de referència per fer molt més que dispensar: oferir serveis. Ortopèdia, anàlisi de paràmetres biomèdics, SPD… Això ve impulsat des de la pròpia farmàcia i des d'organitzacions governamentals, que volen reduir feina de les institucions mèdiques i convertir la farmàcia en referent sanitari.

## Orkava

El farmacèutic té poc temps i ha de fer mil coses, i sovint no té els processos optimitzats: gestió de stock, substitució de genèrics, cross-selling, fidelització de pacients… Orkava neix per ajudar amb tot això. La resta és la història de com hem anat canviant d'hipòtesi per aconseguir-ho.

## Què hem après

Quan vam començar, pensàvem que el farmacèutic necessitava una capa d'intel·ligència sobre l'ERP per prendre millors decisions.

Vam atacar els processos més evidents: gestió de stock, substitució de genèrics, cross-selling, fidelització de pacients, tasques internes i horaris. Totes aquestes funcionalitats aporten valor, però cap forma part del dia a dia. Es consulten quan hi ha un dubte concret, però no generen hàbit.

Ho vam confirmar amb els primers resultats: hem parlat amb unes 70 farmàcies i n'hem instal·lat 12 amb seguiment personalitzat. D'aquestes, només 4 l'usen a diari, 5 setmanalment i 3 no l'usen. Cap explota Orkava com imaginàvem.

Vam intentar reduir la fricció posant-ho tot dins d'un xat. Ha estat útil per a preguntes concretes, com analitzar una marca o entendre una baixada de marge, però no ha creat pull. El farmacèutic només obre el xat quan ja té una pregunta, i això passa poc.

Després vam fer Orkava més proactiu amb notificacions sobre impagats, stock parat, caducitats o altres incidències. Tampoc va funcionar: moltes alertes no porten a una acció clara i és difícil demostrar valor sense mesurar si l'acció s'ha fet ni quin impacte ha tingut.

El mòdul de màrqueting va seguir el mateix patró. Les farmàcies que ja feien màrqueting el van aprofitar i no volien cambiar; les que no, no van crear nous processos.

La següent hipòtesi va ser que estàvem fora del flux de treball. Si volíem formar part del dia a dia, havíem d'estar presents en el moment de la venda. Integrar-nos amb l'ERP va ser molt més difícil del que esperàvem, però ho vam aconseguir per altres vies :).

El resultat tampoc va ser suficient. Els popups semblen útils al principi, però ràpidament es converteixen en una cosa més a la pantalla. Les recomanacions centrades en el pacient i el seu historial aporten més valor que els suggeriments típics de producte, però no vam veure prou evidència que poguessin convertir-se en una part indispensable de la venda.

La conclusió és que no hem aconseguit entrar en cap workflow indispensable del farmacèutic. Hem construït una capa d'intel·ligència per a la farmàcia, però depèn que el farmacèutic decideixi consultar-la. I aquest és precisament el problema: si el producte no forma part d'un procés obligatori, acaba sent una eina que sembla útil, però que cada vegada s'utilitza menys.

## Els competidors

El producte més similar a Orkava que està ben posicionat és Sisfarma. Es posicionen com el CRM de la farmàcia. La webapp és una castanya, i els farmacèutics amb qui hem parlat que el tenen no la fan servir.

Com han aconseguit entrar al mercat? Perquè en realitat són una consultoria.

> NO ESTÁS SOLO:
> TECNOLOGÍA CON ALMA DE CONSULTORÍA
>
> Sisfarma no es solo un software. Ponemos a tu disposición un equipo de asesores expertos en rentabilidad con los que te reunirás cada mes para analizar tu farmacia, fijar estrategias y garantizar resultados.

La consultoria funciona al món de la farmàcia, i hi ha diversos jugadors. Sisfarma ho ha fet molt bé: en construir la plataforma, amb menys dedicació i personal poden oferir una consultoria suficient.

Intelia Pharma posa un popup que et recomana productes en funció d'altres productes. Les farmàcies amb qui hem parlat que el tenen estan descontentes: és car i s'acaba ignorant. Crec que el seu enfocament és erroni, perquè parteix del producte i no de l'historial del pacient.

No hi ha cap jugador que hagi aconseguit entrar al mercat posant-se en el moment de la venda.

Menció a Blistersuite, que ha trobat un flux que el farmacèutic ha de fer per nova normativa i que no està integrat a l'ERP. El programa deixa molt a desitjar, però fa la seva funció i ha capturat el mercat (que és petit).

## Oportunitats

L'oportunitat més clara és competir amb Sisfarma amb un model de service-as-software: convertir-se en una consultoria i intentar optimitzar amb IA tots els processos.

Crec personalment que l'anàlisi i la potenciació de la venda podrien crear mercat, però requeririen ser invisibles: àudio a text, ulleres intel·ligents… I tot això implica passar informació del pacient a tercers i obtenir-ne el consentiment, especialment delicat perquè es parla de salut. Legalment impossible.

No he explorat el tooling per a grups de farmàcies. Crec que aniran creixent i que pràcticament desapareixeran les farmàcies realment independents, de manera que hi ha un mercat emergent (comparatives entre farmàcies del mateix grup, benchmarks, gestió centralitzada de marques pròpies, stocks, reposicions...).

Una altra opció és posicionar-se del costat del laboratori o la marca. Tenen pressupost per educar el farmacèutic i per interactuar-hi comercialment. Es pot intentar automatitzar aquesta feina, o fins i tot a donar eines al farmacèutic (finançades pel laboratori) per treure fricció, facilitar processos o augmentar-ne el coneixement.

I, finalment, construir un ERP modern. El que caldrà és esperar uns anys, que hi hagi relleu generacional i que passin les regulacions del col·legi de farmacèutics. Segurament vindrà per part del propi ERP.

## Conclusió

A la farmàcia, s'adopta tecnologia quan resol un workflow obligatori: l'ERP per la recepta electrònica, Blistersuite per la regulació.

No veig cap producte sense consultoria que actualment pugui crear mercat en aquest espai. Crec que, en uns anys, els ERP aniran introduint aquests fluxos, però és molt difícil competir-hi.

Orkava ha mort. Tenim l'oportunitat d'entrar al mercat i substituir Sisfarma en algunes farmàcies, però des del principi vam decidir que no seriem consultors.
